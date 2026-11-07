"""Provedores de IA. O FixtureProvider é determinístico (dev/CI); o OpenAIProvider faz chamadas reais."""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, TypeVar

import httpx
from pydantic import BaseModel

from . import prompts
from .contracts import (
    AiExecutionMeta,
    CommandIntent,
    ExtractBriefingRequest,
    ExtractBriefingResponse,
    ExtractProjectEventsRequest,
    ExtractProjectEventsResponse,
    InterpretCommandRequest,
    InterpretCommandResponse,
    Model,
    NoIntent,
    ProjectBriefing,
    ProjectEvent,
    TranscribeRequest,
    TranscribeResponse,
)
from .settings import Settings


class AiError(Exception):
    def __init__(self, code: str, message: str, retryable: bool, status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status = status


class AiProvider(Protocol):
    def transcribe(self, req: TranscribeRequest) -> TranscribeResponse: ...
    def extract_briefing(self, req: ExtractBriefingRequest) -> ExtractBriefingResponse: ...
    def extract_project_events(self, req: ExtractProjectEventsRequest) -> ExtractProjectEventsResponse: ...
    def interpret_command(self, req: InterpretCommandRequest) -> InterpretCommandResponse: ...


def _meta(model: str, prompt_version: str, started: float, input_tokens: int = 0, output_tokens: int = 0):
    return AiExecutionMeta(
        executionId=f"aiexec_{uuid.uuid4().hex}",
        model=model,
        promptVersion=prompt_version,
        parserVersion=prompts.PARSER_VERSION,
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        latencyMs=int((time.monotonic() - started) * 1000),
    )


T = TypeVar("T", bound=BaseModel)


# ───────────────────────── Fixture ─────────────────────────


@dataclass
class FixtureProvider:
    """Responde a partir de tests/fixtures/ai/<operação>/<chave>.json.

    Chave = sourceMessageId (transcrição/briefing), id da última mensagem (eventos) ou
    sha256 do texto normalizado (comandos). Sem fixture, devolve um resultado vazio e seguro.
    """

    fixtures_dir: Path

    def _load(self, operation: str, key: str, model: type[T]) -> T | None:
        path = self.fixtures_dir / "ai" / operation / f"{key}.json"
        if not path.is_file():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return model.model_validate({k: v for k, v in data.items() if not k.startswith("_")})

    def transcribe(self, req: TranscribeRequest) -> TranscribeResponse:
        started = time.monotonic()
        found = self._load("transcribe", req.sourceMessageId, _TranscriptFixture)
        return TranscribeResponse(
            text=found.text if found else "",
            durationSeconds=found.durationSeconds if found else None,
            meta=_meta("fixture", prompts.TRANSCRIBE_VERSION, started),
        )

    def extract_briefing(self, req: ExtractBriefingRequest) -> ExtractBriefingResponse:
        started = time.monotonic()
        found = self._load("briefing", req.sourceMessageId, ProjectBriefing)
        briefing = found or ProjectBriefing(
            title=None,
            objective=None,
            deliverables=[],
            deadlines=[],
            owners=[],
            estimatedBudgetCents=None,
            openQuestions=[],
            proposedTasks=[],
        )
        return ExtractBriefingResponse(
            briefing=briefing, meta=_meta("fixture", prompts.BRIEFING_VERSION, started)
        )

    def extract_project_events(self, req: ExtractProjectEventsRequest) -> ExtractProjectEventsResponse:
        started = time.monotonic()
        found = self._load("events", req.messages[-1].id, _EventsOutput)
        return ExtractProjectEventsResponse(
            events=found.events if found else [],
            meta=_meta("fixture", prompts.PROJECT_EVENTS_VERSION, started),
        )

    def interpret_command(self, req: InterpretCommandRequest) -> InterpretCommandResponse:
        started = time.monotonic()
        key = hashlib.sha256(" ".join(req.text.lower().split()).encode()).hexdigest()
        found = self._load("commands", key, _CommandOutput)
        return InterpretCommandResponse(
            command=found.command if found else NoIntent(intent="none"),
            confidence=found.confidence if found else 1.0,
            clarificationQuestion=found.clarificationQuestion if found else None,
            meta=_meta("fixture", prompts.COMMANDS_VERSION, started),
        )


class _TranscriptFixture(Model):
    text: str
    durationSeconds: float | None


class _EventsOutput(Model):
    events: list[ProjectEvent]


class _CommandOutput(Model):
    command: CommandIntent
    confidence: float
    clarificationQuestion: str | None


# ───────────────────────── OpenAI ─────────────────────────


class OpenAIProvider:
    """Chamadas reais à OpenAI com saída estruturada validada pelos modelos Pydantic do contrato."""

    def __init__(self, settings: Settings):
        from openai import OpenAI

        if not settings.openai_api_key:
            raise RuntimeError("AI_PROVIDER=openai exige OPENAI_API_KEY")
        self._client = OpenAI(
            api_key=settings.openai_api_key, timeout=settings.openai_timeout_seconds, max_retries=1
        )
        self._model = settings.openai_model
        self._transcribe_model = settings.openai_transcribe_model
        self._timeout = settings.openai_timeout_seconds

    def _parse(self, system: str, payload: BaseModel, output: type[T]) -> tuple[T, int, int]:
        from openai import APIConnectionError, APIStatusError, APITimeoutError

        try:
            response = self._client.responses.parse(
                model=self._model,
                input=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": payload.model_dump_json(by_alias=True)},
                ],
                text_format=output,
            )
        except APITimeoutError as e:
            raise AiError("upstream_timeout", "OpenAI não respondeu a tempo", True, 504) from e
        except APIConnectionError as e:
            raise AiError("upstream_unavailable", "Falha de conexão com a OpenAI", True) from e
        except APIStatusError as e:
            retryable = e.status_code == 429 or e.status_code >= 500
            raise AiError("upstream_error", f"OpenAI HTTP {e.status_code}", retryable) from e
        parsed = response.output_parsed
        if parsed is None:
            raise AiError("unparseable_output", "Saída do modelo fora do schema", False)
        usage = response.usage
        return parsed, (usage.input_tokens if usage else 0), (usage.output_tokens if usage else 0)

    def transcribe(self, req: TranscribeRequest) -> TranscribeResponse:
        started = time.monotonic()
        try:
            media = httpx.get(req.mediaUrl, timeout=self._timeout, follow_redirects=False)
            media.raise_for_status()
        except httpx.HTTPError as e:
            raise AiError("media_unavailable", "Não foi possível baixar o áudio", True) from e
        ext = req.mimeType.split("/")[-1].split(";")[0].strip() or "ogg"
        result = self._client.audio.transcriptions.create(
            model=self._transcribe_model,
            file=(f"audio.{ext}", media.content, req.mimeType.split(";")[0]),
            language=req.language,
        )
        return TranscribeResponse(
            text=result.text,
            durationSeconds=None,
            meta=_meta(self._transcribe_model, prompts.TRANSCRIBE_VERSION, started),
        )

    def extract_briefing(self, req: ExtractBriefingRequest) -> ExtractBriefingResponse:
        started = time.monotonic()
        out, i, o = self._parse(prompts.BRIEFING_SYSTEM, req, ProjectBriefing)
        return ExtractBriefingResponse(
            briefing=out, meta=_meta(self._model, prompts.BRIEFING_VERSION, started, i, o)
        )

    def extract_project_events(self, req: ExtractProjectEventsRequest) -> ExtractProjectEventsResponse:
        started = time.monotonic()
        out, i, o = self._parse(prompts.PROJECT_EVENTS_SYSTEM, req, _EventsOutput)
        known = {m.id for m in req.messages}
        # A IA não pode atribuir evento a uma mensagem que não foi enviada a ela.
        events = [e for e in out.events if e.sourceMessageId in known]
        return ExtractProjectEventsResponse(
            events=events, meta=_meta(self._model, prompts.PROJECT_EVENTS_VERSION, started, i, o)
        )

    def interpret_command(self, req: InterpretCommandRequest) -> InterpretCommandResponse:
        started = time.monotonic()
        out, i, o = self._parse(prompts.COMMANDS_SYSTEM, req, _CommandOutput)
        return InterpretCommandResponse(
            command=out.command,
            confidence=max(0.0, min(1.0, out.confidence)),
            clarificationQuestion=out.clarificationQuestion,
            meta=_meta(self._model, prompts.COMMANDS_VERSION, started, i, o),
        )


def build_provider(settings: Settings) -> AiProvider:
    if settings.ai_provider == "openai":
        return OpenAIProvider(settings)
    return FixtureProvider(settings.fixtures_dir)
