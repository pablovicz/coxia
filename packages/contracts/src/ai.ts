import { z } from 'zod';
import { amountCents, confidence, currency, isoDate, isoDateTime } from './common';

/**
 * Contrato HTTP interno NestJS ↔ FastAPI.
 * A IA apenas propõe; o NestJS valida permissões, estado e conflitos antes de aplicar.
 * Espelhado em apps/ai/coxia_ai/contracts.py; a paridade é verificada pelos golden tests
 * com os exemplos de tests/fixtures/contracts.
 */

export const aiExecutionMeta = z.object({
  executionId: z.string().min(1),
  model: z.string(),
  promptVersion: z.string(),
  parserVersion: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
});
export type AiExecutionMeta = z.infer<typeof aiExecutionMeta>;

// ---------- Transcrição ----------
export const transcribeRequest = z.object({
  /** URL assinada e com expiração do bucket. */
  mediaUrl: z.string().url(),
  mimeType: z.string(),
  language: z.string(),
  sourceMessageId: z.string(),
});
export type TranscribeRequest = z.infer<typeof transcribeRequest>;

export const transcribeResponse = z.object({
  text: z.string(),
  durationSeconds: z.number().nonnegative().nullable(),
  meta: aiExecutionMeta,
});
export type TranscribeResponse = z.infer<typeof transcribeResponse>;

// ---------- Mensagens de contexto ----------
export const contextMessage = z.object({
  id: z.string(),
  authorPhone: z.string().nullable(),
  authorName: z.string().nullable(),
  sentAt: isoDateTime,
  text: z.string(),
  attachmentKind: z.enum(['audio', 'image', 'document', 'video']).nullable(),
});
export type ContextMessage = z.infer<typeof contextMessage>;

// ---------- Briefing de projeto ----------
export const extractBriefingRequest = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  timezone: z.string(),
  now: isoDateTime,
  transcript: z.string().min(1),
  sourceMessageId: z.string(),
});
export type ExtractBriefingRequest = z.infer<typeof extractBriefingRequest>;

export const projectBriefing = z.object({
  title: z.string().nullable(),
  objective: z.string().nullable(),
  deliverables: z.array(z.string()),
  deadlines: z.array(z.object({ description: z.string(), date: isoDate.nullable() })),
  owners: z.array(z.object({ name: z.string(), responsibility: z.string().nullable() })),
  estimatedBudgetCents: amountCents.nullable(),
  openQuestions: z.array(z.string()),
  proposedTasks: z.array(
    z.object({
      title: z.string(),
      assigneeName: z.string().nullable(),
      dueDate: isoDate.nullable(),
    }),
  ),
});
export type ProjectBriefing = z.infer<typeof projectBriefing>;

export const extractBriefingResponse = z.object({
  briefing: projectBriefing,
  meta: aiExecutionMeta,
});
export type ExtractBriefingResponse = z.infer<typeof extractBriefingResponse>;

// ---------- Eventos de projeto ----------
const eventBase = {
  sourceMessageId: z.string(),
  confidence,
  /** Distingue compromisso assumido de mera sugestão. */
  commitment: z.enum(['committed', 'suggested', 'unclear']),
  /** Trecho literal da mensagem que sustenta o evento. */
  evidence: z.string(),
};

export const projectEvent = z.discriminatedUnion('type', [
  z.object({
    ...eventBase,
    type: z.literal('task'),
    title: z.string(),
    assigneeName: z.string().nullable(),
    dueDate: isoDate.nullable(),
  }),
  /** Alguém avisa que terminou uma tarefa já registrada (título como está no estado do projeto). */
  z.object({ ...eventBase, type: z.literal('task_done'), taskTitle: z.string() }),
  z.object({ ...eventBase, type: z.literal('decision'), summary: z.string() }),
  z.object({
    ...eventBase,
    type: z.literal('quote'),
    description: z.string(),
    vendor: z.string().nullable(),
    amountCents: amountCents.nullable(),
    currency,
  }),
  z.object({
    ...eventBase,
    type: z.literal('expense'),
    description: z.string(),
    vendor: z.string().nullable(),
    amountCents: amountCents.nullable(),
    currency,
    /** O que a mensagem afirma. Anexo não é quitação: o domínio decide o status real. */
    claimedStatus: z.enum(['planned', 'incurred', 'paid']),
  }),
  z.object({
    ...eventBase,
    type: z.literal('payment_proof'),
    description: z.string(),
    amountCents: amountCents.nullable(),
    currency,
    paidOn: isoDate.nullable(),
  }),
  z.object({ ...eventBase, type: z.literal('question'), question: z.string() }),
  z.object({ ...eventBase, type: z.literal('close_request'), reason: z.string().nullable() }),
]);
export type ProjectEvent = z.infer<typeof projectEvent>;
export type ProjectEventType = ProjectEvent['type'];

export const extractProjectEventsRequest = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectTitle: z.string().nullable(),
  timezone: z.string(),
  now: isoDateTime,
  /** Estado estruturado atual (resumo), em vez de reler todo o histórico. */
  projectStateSummary: z.string().nullable(),
  messages: z.array(contextMessage).min(1),
});
export type ExtractProjectEventsRequest = z.infer<typeof extractProjectEventsRequest>;

export const extractProjectEventsResponse = z.object({
  events: z.array(projectEvent),
  meta: aiExecutionMeta,
});
export type ExtractProjectEventsResponse = z.infer<typeof extractProjectEventsResponse>;

// ---------- Interpretação de comandos (agenda, contas, projetos) ----------
export const commandIntent = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('booking.check_availability'),
    spaceHint: z.string().nullable(),
    from: isoDateTime,
    to: isoDateTime,
  }),
  z.object({
    intent: z.literal('booking.create'),
    spaceHint: z.string(),
    startAt: isoDateTime,
    endAt: isoDateTime,
    responsibleName: z.string().nullable(),
    notes: z.string().nullable(),
    recurrence: z
      .object({
        freq: z.literal('WEEKLY'),
        /** ISO: 1 = segunda … 7 = domingo. */
        byWeekday: z.array(z.number().int().min(1).max(7)),
      })
      .nullable(),
  }),
  z.object({
    intent: z.literal('booking.cancel'),
    spaceHint: z.string().nullable(),
    around: isoDateTime,
  }),
  z.object({
    intent: z.literal('bill.mark_paid'),
    billHint: z.string(),
    amountCents: amountCents.nullable(),
    paidOn: isoDate.nullable(),
  }),
  z.object({ intent: z.literal('project.close') }),
  z.object({ intent: z.literal('summary.today') }),
  z.object({ intent: z.literal('none') }),
]);
export type CommandIntent = z.infer<typeof commandIntent>;

export const interpretCommandRequest = z.object({
  organizationId: z.string(),
  timezone: z.string(),
  now: isoDateTime,
  text: z.string().min(1),
  knownSpaces: z.array(
    z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()) }),
  ),
  knownBills: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type InterpretCommandRequest = z.infer<typeof interpretCommandRequest>;

export const interpretCommandResponse = z.object({
  command: commandIntent,
  confidence,
  /** Quando preenchido, a Coxia pergunta antes de agir. */
  clarificationQuestion: z.string().nullable(),
  meta: aiExecutionMeta,
});
export type InterpretCommandResponse = z.infer<typeof interpretCommandResponse>;

export const aiErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
});
export type AiErrorResponse = z.infer<typeof aiErrorResponse>;
