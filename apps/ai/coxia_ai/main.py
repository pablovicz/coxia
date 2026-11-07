"""Serviço de IA da Coxia (FastAPI).

Camada estreita: recebe dados já autorizados pelo NestJS, devolve propostas tipadas.
Não acessa o banco de negócio. Rede privada + token Bearer compartilhado.
"""

from __future__ import annotations

import hmac
import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .contracts import (
    AiErrorBody,
    AiErrorResponse,
    ExtractBriefingRequest,
    ExtractBriefingResponse,
    ExtractProjectEventsRequest,
    ExtractProjectEventsResponse,
    InterpretCommandRequest,
    InterpretCommandResponse,
    TranscribeRequest,
    TranscribeResponse,
)
from .providers import AiError, AiProvider, build_provider
from .settings import Settings, get_settings

logger = logging.getLogger("coxia_ai")

# Em escopo de módulo: com `from __future__ import annotations`, o FastAPI resolve as anotações
# pelos globals do módulo.
IdemKey = Annotated[str | None, Header(alias="idempotency-key")]


class IdempotencyCache:
    """Evita cobrar duas vezes quando o worker reenvia a mesma requisição (mesma Idempotency-Key)."""

    def __init__(self, max_items: int = 2000, ttl_seconds: int = 3600):
        self._items: OrderedDict[str, tuple[float, BaseModel]] = OrderedDict()
        self._max = max_items
        self._ttl = ttl_seconds
        self._lock = threading.Lock()

    def get_or_compute(self, key: str | None, fn: Callable[[], BaseModel]) -> BaseModel:
        if not key:
            return fn()
        now = time.monotonic()
        with self._lock:
            hit = self._items.get(key)
            if hit and now - hit[0] < self._ttl:
                return hit[1]
        value = fn()
        with self._lock:
            self._items[key] = (now, value)
            self._items.move_to_end(key)
            while len(self._items) > self._max:
                self._items.popitem(last=False)
        return value


def _error(status: int, code: str, message: str, retryable: bool) -> JSONResponse:
    body = AiErrorResponse(error=AiErrorBody(code=code, message=message, retryable=retryable))
    return JSONResponse(status_code=status, content=body.model_dump())


def create_app(settings: Settings | None = None, provider: AiProvider | None = None) -> FastAPI:
    settings = settings or get_settings()
    provider = provider or build_provider(settings)
    cache = IdempotencyCache()
    app = FastAPI(title="Coxia AI", version="0.1.0", docs_url=None, redoc_url=None)

    def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
        expected = f"Bearer {settings.ai_service_token}"
        if not authorization or not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise AiError("unauthorized", "Token inválido", False, 401)

    auth = Depends(require_token)

    @app.exception_handler(AiError)
    async def _ai_error(_: Request, exc: AiError) -> JSONResponse:
        if exc.status >= 500:
            logger.warning("ai_error code=%s retryable=%s", exc.code, exc.retryable)
        return _error(exc.status, exc.code, exc.message, exc.retryable)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = ", ".join(".".join(str(p) for p in e["loc"][1:]) for e in exc.errors())
        return _error(422, "invalid_request", f"Campos inválidos: {fields}", False)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "service": "ai", "provider": settings.ai_provider}

    @app.post("/v1/transcribe", dependencies=[auth])
    def transcribe(req: TranscribeRequest, idempotency_key: IdemKey = None) -> TranscribeResponse:
        return cache.get_or_compute(idempotency_key, lambda: provider.transcribe(req))  # type: ignore[return-value]

    @app.post("/v1/projects/briefing", dependencies=[auth])
    def briefing(req: ExtractBriefingRequest, idempotency_key: IdemKey = None) -> ExtractBriefingResponse:
        return cache.get_or_compute(idempotency_key, lambda: provider.extract_briefing(req))  # type: ignore[return-value]

    @app.post("/v1/projects/events", dependencies=[auth])
    def events(
        req: ExtractProjectEventsRequest, idempotency_key: IdemKey = None
    ) -> ExtractProjectEventsResponse:
        return cache.get_or_compute(idempotency_key, lambda: provider.extract_project_events(req))  # type: ignore[return-value]

    @app.post("/v1/commands/interpret", dependencies=[auth])
    def interpret(req: InterpretCommandRequest, idempotency_key: IdemKey = None) -> InterpretCommandResponse:
        return cache.get_or_compute(idempotency_key, lambda: provider.interpret_command(req))  # type: ignore[return-value]

    return app


def app_factory() -> FastAPI:
    logging.basicConfig(
        level=get_settings().log_level.upper(), format='{"level":"%(levelname)s","msg":"%(message)s"}'
    )
    return create_app()
