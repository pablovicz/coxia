"""Contrato HTTP interno NestJS ↔ FastAPI.

Espelho de packages/contracts/src/ai.ts. Os campos usam camelCase de propósito, para que o JSON
seja idêntico nos dois lados. A paridade é verificada em tests/test_contracts.py com os mesmos
exemplos de tests/fixtures/contracts e com os JSON Schemas exportados do zod.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

IsoDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
AmountCents = Annotated[int, Field(ge=0, strict=True)]
Confidence = Annotated[float, Field(ge=0, le=1)]
NonNegInt = Annotated[int, Field(ge=0, strict=True)]
# Como no zod (`datetime({ offset: true })`): string ISO 8601 com fuso; sem offset é rejeitado.
IsoDateTime = AwareDatetime


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AiExecutionMeta(Model):
    executionId: Annotated[str, Field(min_length=1)]
    model: str
    promptVersion: str
    parserVersion: str
    inputTokens: NonNegInt
    outputTokens: NonNegInt
    latencyMs: NonNegInt


# ---------- Transcrição ----------
class TranscribeRequest(Model):
    mediaUrl: Annotated[str, Field(pattern=r"^https?://")]
    mimeType: str
    language: str
    sourceMessageId: str


class TranscribeResponse(Model):
    text: str
    durationSeconds: Annotated[float, Field(ge=0)] | None
    meta: AiExecutionMeta


# ---------- Mensagens de contexto ----------
class ContextMessage(Model):
    id: str
    authorPhone: str | None
    authorName: str | None
    sentAt: IsoDateTime
    text: str
    attachmentKind: Literal["audio", "image", "document", "video"] | None


# ---------- Briefing ----------
class ExtractBriefingRequest(Model):
    organizationId: str
    projectId: str
    timezone: str
    now: IsoDateTime
    transcript: Annotated[str, Field(min_length=1)]
    sourceMessageId: str


class Deadline(Model):
    description: str
    date: IsoDate | None


class Owner(Model):
    name: str
    responsibility: str | None


class ProposedTask(Model):
    title: str
    assigneeName: str | None
    dueDate: IsoDate | None


class ProjectBriefing(Model):
    title: str | None
    objective: str | None
    deliverables: list[str]
    deadlines: list[Deadline]
    owners: list[Owner]
    estimatedBudgetCents: AmountCents | None
    openQuestions: list[str]
    proposedTasks: list[ProposedTask]


class ExtractBriefingResponse(Model):
    briefing: ProjectBriefing
    meta: AiExecutionMeta


# ---------- Eventos de projeto ----------
Commitment = Literal["committed", "suggested", "unclear"]


class _EventBase(Model):
    sourceMessageId: str
    confidence: Confidence
    commitment: Commitment
    evidence: str


class TaskEvent(_EventBase):
    type: Literal["task"]
    title: str
    assigneeName: str | None
    dueDate: IsoDate | None


class TaskDoneEvent(_EventBase):
    type: Literal["task_done"]
    taskTitle: str


class DecisionEvent(_EventBase):
    type: Literal["decision"]
    summary: str


class QuoteEvent(_EventBase):
    type: Literal["quote"]
    description: str
    vendor: str | None
    amountCents: AmountCents | None
    currency: Literal["BRL"]


class ExpenseEvent(_EventBase):
    type: Literal["expense"]
    description: str
    vendor: str | None
    amountCents: AmountCents | None
    currency: Literal["BRL"]
    claimedStatus: Literal["planned", "incurred", "paid"]


class PaymentProofEvent(_EventBase):
    type: Literal["payment_proof"]
    description: str
    amountCents: AmountCents | None
    currency: Literal["BRL"]
    paidOn: IsoDate | None


class QuestionEvent(_EventBase):
    type: Literal["question"]
    question: str


class CloseRequestEvent(_EventBase):
    type: Literal["close_request"]
    reason: str | None


ProjectEvent = Annotated[
    TaskEvent
    | TaskDoneEvent
    | DecisionEvent
    | QuoteEvent
    | ExpenseEvent
    | PaymentProofEvent
    | QuestionEvent
    | CloseRequestEvent,
    Field(discriminator="type"),
]


class ExtractProjectEventsRequest(Model):
    organizationId: str
    projectId: str
    projectTitle: str | None
    timezone: str
    now: IsoDateTime
    projectStateSummary: str | None
    messages: Annotated[list[ContextMessage], Field(min_length=1)]


class ExtractProjectEventsResponse(Model):
    events: list[ProjectEvent]
    meta: AiExecutionMeta


# ---------- Comandos ----------
class Recurrence(Model):
    freq: Literal["WEEKLY"]
    byWeekday: list[Annotated[int, Field(ge=1, le=7, strict=True)]]


class CheckAvailability(Model):
    intent: Literal["booking.check_availability"]
    spaceHint: str | None
    from_: IsoDateTime = Field(alias="from")
    to: IsoDateTime


class CreateBooking(Model):
    intent: Literal["booking.create"]
    spaceHint: str
    startAt: IsoDateTime
    endAt: IsoDateTime
    responsibleName: str | None
    notes: str | None
    recurrence: Recurrence | None


class CancelBooking(Model):
    intent: Literal["booking.cancel"]
    spaceHint: str | None
    around: IsoDateTime


class MarkBillPaid(Model):
    intent: Literal["bill.mark_paid"]
    billHint: str
    amountCents: AmountCents | None
    paidOn: IsoDate | None


class CloseProject(Model):
    intent: Literal["project.close"]


class SummaryToday(Model):
    intent: Literal["summary.today"]


class NoIntent(Model):
    intent: Literal["none"]


CommandIntent = Annotated[
    CheckAvailability | CreateBooking | CancelBooking | MarkBillPaid | CloseProject | SummaryToday | NoIntent,
    Field(discriminator="intent"),
]


class KnownSpace(Model):
    id: str
    name: str
    aliases: list[str]


class KnownBill(Model):
    id: str
    name: str


class InterpretCommandRequest(Model):
    organizationId: str
    timezone: str
    now: IsoDateTime
    text: Annotated[str, Field(min_length=1)]
    knownSpaces: list[KnownSpace]
    knownBills: list[KnownBill]


class InterpretCommandResponse(Model):
    command: CommandIntent
    confidence: Confidence
    clarificationQuestion: str | None
    meta: AiExecutionMeta


class AiErrorBody(Model):
    code: str
    message: str
    retryable: bool


class AiErrorResponse(Model):
    error: AiErrorBody


CONTRACTS: dict[str, type[BaseModel]] = {
    "TranscribeRequest": TranscribeRequest,
    "TranscribeResponse": TranscribeResponse,
    "ExtractBriefingRequest": ExtractBriefingRequest,
    "ExtractBriefingResponse": ExtractBriefingResponse,
    "ExtractProjectEventsRequest": ExtractProjectEventsRequest,
    "ExtractProjectEventsResponse": ExtractProjectEventsResponse,
    "InterpretCommandRequest": InterpretCommandRequest,
    "InterpretCommandResponse": InterpretCommandResponse,
    "AiErrorResponse": AiErrorResponse,
}
