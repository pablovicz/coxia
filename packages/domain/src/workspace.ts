import type {
  AiExecutionMeta,
  ContextMessage,
  ExtractBriefingRequest,
  ExtractBriefingResponse,
  ExtractProjectEventsRequest,
  ExtractProjectEventsResponse,
  ProjectEvent,
} from '@coxia/contracts';
import type { Prisma } from '@coxia/database';
import { isUniqueViolation } from '@coxia/database';
import { formatBRL, normalizeText, stableHash } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError, getOrganization, type Tx } from './common';
import {
  composeBriefingConfirmation,
  composeWorkspaceWelcome,
  decideEvent,
  eventFingerprint,
  isBriefingText,
  isCloseCommand,
  isTrivialMessage,
  loadProjectState,
  matchTaskTitle,
  ProjectService,
  projectStateText,
} from './projects';

/** Extração de briefing e eventos (FastAPI). Injetado para permitir stub nos testes. */
export interface ProjectAi {
  extractBriefing(req: ExtractBriefingRequest, idempotencyKey: string): Promise<ExtractBriefingResponse>;
  extractProjectEvents(req: ExtractProjectEventsRequest, idempotencyKey: string): Promise<ExtractProjectEventsResponse>;
}

export interface GroupMessageContext {
  organizationId: string;
  conversationId: string;
  messageId: string;
  /** whatsapp_groups.id */
  whatsappGroupId: string;
  groupName: string | null;
  senderPhone: string | null;
  senderName: string | null;
  sentAt: Date;
  /** Texto da mensagem, ou a transcrição quando for áudio. */
  text: string;
  /** O texto veio da transcrição de um áudio. */
  fromAudio: boolean;
  /** Imagem/documento já copiado para o bucket. */
  attachment: { id: string; kind: string; sha256: string | null } | null;
  /** Projeto já vinculado ao grupo, se houver. */
  projectId: string | null;
  now?: Date;
}

export interface GroupMessageResult {
  projectId: string | null;
  /** Resposta para o grupo; null = silêncio. */
  reply: string | null;
  actions: string[];
}

/** Num grupo, "ok" e "pode" são ambíguos demais para encerrar um projeto: só respostas explícitas. */
const YES = /^(sim|confirmo|confirmar|confirma|pode encerrar)[.!\s]*$/i;
const NO = /^(n[aã]o|deixa|esquece|cancela|cancelar)[.!\s]*$/i;
const CLOSE_CONFIRM_TTL_MS = 30 * 60_000;
const CONTEXT_MESSAGES = 8;

/**
 * Conversa num grupo de projeto. Regras:
 * - Só quem coordena projetos ativa o workspace, manda briefing que vira registro oficial e encerra.
 * - Cada mensagem gera eventos uma única vez (fingerprint por mensagem); reenvio não duplica.
 * - A Coxia só fala no grupo quando há algo relevante: ativação, briefing, comprovante repetido,
 *   prévia/relatório de encerramento ou pedido sem permissão.
 */
export class ProjectWorkspaceService {
  private readonly projects: ProjectService;

  constructor(
    private readonly db: Db,
    private readonly ai: ProjectAi,
  ) {
    this.projects = new ProjectService(db);
  }

  async handle(ctx: GroupMessageContext): Promise<GroupMessageResult> {
    const now = ctx.now ?? new Date();
    const actor: Actor = { channel: 'whatsapp', phone: ctx.senderPhone, sourceMessageId: ctx.messageId };
    const isManager = await this.projects.canManage(ctx.organizationId, ctx.senderPhone);
    const replies: string[] = [];
    const actions: string[] = [];
    const text = ctx.text.trim();

    // 1. Workspace: grupo novo só é ativado por quem coordena projetos.
    let projectId = ctx.projectId;
    if (!projectId) {
      if (!isManager || !ctx.senderPhone || !ctx.groupName) return { projectId: null, reply: null, actions: ['not_authorized_to_activate'] };
      const { project, created } = await this.projects.activateFromGroup(
        ctx.organizationId,
        { whatsappGroupId: ctx.whatsappGroupId, groupName: ctx.groupName, activatedByPhone: ctx.senderPhone },
        actor,
        now,
      );
      projectId = project.id;
      if (project.status === 'closed') return { projectId, reply: null, actions: ['project_closed'] };
      if (created) {
        const org = await getOrganization(this.db, ctx.organizationId);
        replies.push(composeWorkspaceWelcome(project.title, org.retentionDays));
        actions.push('workspace_activated');
      }
    } else if (ctx.groupName) {
      if (await this.projects.syncGroupName(ctx.organizationId, projectId, ctx.whatsappGroupId, ctx.groupName, actor)) actions.push('group_renamed');
    }

    const result = (): GroupMessageResult => ({ projectId, reply: replies.length ? replies.join('\n\n') : null, actions });

    // 2. Resposta a uma confirmação pendente (só de quem pediu).
    if (text && (YES.test(text) || NO.test(text))) {
      const resolved = await this.resolvePending(ctx, projectId, YES.test(text), actor, now);
      if (resolved) {
        if (resolved.reply) replies.push(resolved.reply);
        actions.push(resolved.action);
        return result();
      }
    }

    // 3. Encerramento por palavra-chave, validando o participante.
    if (text && isCloseCommand(text)) {
      const r = await this.requestClose(ctx, projectId, isManager, actor, now);
      replies.push(r.reply);
      actions.push(r.action);
      return result();
    }

    if (!text) return result();

    // 4. Briefing: primeiro áudio de quem coordena (sem briefing ainda) ou "Briefing: ...".
    const project = await this.db.project.findUniqueOrThrow({ where: { id: projectId } });
    if (isManager && ((ctx.fromAudio && project.briefing === null) || isBriefingText(text))) {
      const transcript = isBriefingText(text) ? text.replace(/^briefing\b\s*[:\-–—]?\s*/i, '') : text;
      const r = await this.applyBriefing(ctx, project, transcript, actor, now);
      if (r) {
        replies.push(r);
        actions.push('briefing_registered');
      }
      return result();
    }

    // 5. Eventos (tarefas, decisões, orçamentos, despesas, comprovantes).
    if (isTrivialMessage(text)) {
      actions.push('trivial');
      return result();
    }
    const ev = await this.extractAndApply(ctx, projectId, project.title, text, isManager, actor, now);
    replies.push(...ev.replies);
    actions.push(...ev.actions);
    return result();
  }

  // ───────────── briefing ─────────────

  private async applyBriefing(
    ctx: GroupMessageContext,
    project: { id: string; title: string; objective: string | null; estimatedBudgetCents: number | null },
    transcript: string,
    actor: Actor,
    now: Date,
  ): Promise<string | null> {
    if (!transcript.trim()) return null;
    const org = await getOrganization(this.db, ctx.organizationId);
    const res = await this.ai.extractBriefing(
      { organizationId: ctx.organizationId, projectId: project.id, timezone: org.timezone, now: now.toISOString(), transcript, sourceMessageId: ctx.messageId },
      `briefing:${ctx.messageId}`,
    );
    const exec = await recordAiExecution(this.db, ctx.organizationId, 'extract_briefing', res.meta, { transcript }, ctx.messageId);
    const b = res.briefing;
    try {
      await this.db.$transaction(async (tx) => {
        await tx.projectEvent.create({
          data: {
            organizationId: ctx.organizationId,
            projectId: project.id,
            type: 'briefing',
            sourceMessageId: ctx.messageId,
            fingerprint: stableHash({ t: 'briefing', transcript: normalizeText(transcript) }),
            payload: b as unknown as Prisma.InputJsonValue,
            commitment: 'committed',
            reviewStatus: 'auto_applied',
            authorPhone: ctx.senderPhone,
            ...metaColumns(res.meta, exec),
          },
        });
        await tx.project.update({
          where: { id: project.id },
          data: {
            briefing: b as unknown as Prisma.InputJsonValue,
            objective: b.objective ?? project.objective,
            estimatedBudgetCents: b.estimatedBudgetCents ?? project.estimatedBudgetCents,
          },
        });
        // Tarefas do briefing são propostas: alguém revisa antes de virarem compromisso.
        for (const t of b.proposedTasks) {
          await tx.projectTask.create({
            data: {
              organizationId: ctx.organizationId,
              projectId: project.id,
              title: t.title,
              assigneeName: t.assigneeName,
              dueDate: t.dueDate ? new Date(`${t.dueDate}T00:00:00.000Z`) : null,
              status: 'proposed',
              sourceMessageId: ctx.messageId,
            },
          });
        }
        await audit(tx, ctx.organizationId, actor, 'project.briefing', 'project', project.id, { after: { tasks: b.proposedTasks.length } });
      });
    } catch (err) {
      if (isUniqueViolation(err)) return null; // mesmo briefing já registrado (reprocessamento)
      throw err;
    }
    return composeBriefingConfirmation(project.title, b);
  }

  // ───────────── eventos ─────────────

  private async extractAndApply(
    ctx: GroupMessageContext,
    projectId: string,
    title: string,
    text: string,
    isManager: boolean,
    actor: Actor,
    now: Date,
  ): Promise<{ replies: string[]; actions: string[] }> {
    const org = await getOrganization(this.db, ctx.organizationId);
    const state = await loadProjectState(this.db, projectId);
    const previous = await this.db.message.findMany({
      where: { conversationId: ctx.conversationId, id: { not: ctx.messageId }, sentAt: { lte: ctx.sentAt }, fromMe: false },
      orderBy: { sentAt: 'desc' },
      take: CONTEXT_MESSAGES,
      include: { attachments: { select: { kind: true, transcript: true } } },
    });
    const toContext = (m: (typeof previous)[number]): ContextMessage | null => {
      const t = m.text ?? m.attachments.find((a) => a.transcript)?.transcript ?? '';
      if (!t.trim()) return null;
      return { id: m.id, authorPhone: m.senderPhone, authorName: m.senderName, sentAt: m.sentAt.toISOString(), text: t, attachmentKind: attachmentKind(m.attachments[0]?.kind) };
    };
    const messages: ContextMessage[] = [
      ...previous.reverse().map(toContext).filter((m): m is ContextMessage => m !== null),
      {
        id: ctx.messageId,
        authorPhone: ctx.senderPhone,
        authorName: ctx.senderName,
        sentAt: ctx.sentAt.toISOString(),
        text,
        attachmentKind: ctx.fromAudio ? 'audio' : attachmentKind(ctx.attachment?.kind),
      },
    ];

    const res = await this.ai.extractProjectEvents(
      {
        organizationId: ctx.organizationId,
        projectId,
        projectTitle: title,
        timezone: org.timezone,
        now: now.toISOString(),
        projectStateSummary: projectStateText(state),
        messages,
      },
      `events:${ctx.messageId}`,
    );
    const exec = await recordAiExecution(this.db, ctx.organizationId, 'extract_project_events', res.meta, { messages: messages.map((m) => m.id) }, ctx.messageId);

    const replies: string[] = [];
    const actions: string[] = [];
    // Só eventos desta mensagem: as anteriores são contexto e já foram processadas.
    for (const e of res.events.filter((ev) => ev.sourceMessageId === ctx.messageId)) {
      const r = await this.applyEvent(ctx, projectId, e, isManager, actor, res.meta, exec, now);
      actions.push(r.action);
      if (r.reply) replies.push(r.reply);
      if (r.close) {
        const c = await this.requestClose(ctx, projectId, isManager, actor, now);
        replies.push(c.reply);
        actions.push(c.action);
      }
    }
    return { replies, actions };
  }

  private async applyEvent(
    ctx: GroupMessageContext,
    projectId: string,
    e: ProjectEvent,
    isManager: boolean,
    actor: Actor,
    meta: AiExecutionMeta,
    execId: string,
    now: Date,
  ): Promise<{ action: string; reply?: string; close?: boolean }> {
    const proofSha = ctx.attachment?.sha256 ?? null;
    const hasProof = !!proofSha && (ctx.attachment?.kind === 'image' || ctx.attachment?.kind === 'document');
    const decision = decideEvent(e, { isManager, hasProof });
    let review = decision.review;
    let duplicateOf: string | null = null;

    // Comprovante repetido (aqui ou numa conta mensal) não quita nada de novo.
    if (decision.expense?.withProof && proofSha) {
      duplicateOf = await this.findProofUse(ctx.organizationId, proofSha);
      if (duplicateOf) review = 'rejected';
    }

    const base = {
      organizationId: ctx.organizationId,
      projectId,
      type: e.type,
      sourceMessageId: ctx.messageId,
      fingerprint: eventFingerprint(e),
      payload: e as unknown as Prisma.InputJsonValue,
      confidence: e.confidence,
      commitment: e.commitment,
      authorPhone: ctx.senderPhone,
      ...metaColumns(meta, execId),
    };

    try {
      return await this.db.$transaction(async (tx) => {
        if (duplicateOf) {
          await tx.projectEvent.create({ data: { ...base, reviewStatus: 'rejected' } });
          return { action: `${e.type}:duplicate_proof`, reply: `Esse comprovante já foi registrado (${duplicateOf}). Não lancei de novo.` };
        }

        // task_done precisa casar com uma tarefa em aberto; sem casamento claro, vai para revisão.
        let doneTaskId: string | null = null;
        if (decision.taskDone && e.type === 'task_done') {
          const open = await tx.projectTask.findMany({ where: { projectId, status: { in: ['open', 'proposed'] } } });
          doneTaskId = matchTaskTitle(open, e.taskTitle)?.id ?? null;
          if (!doneTaskId) review = 'pending_review';
        }

        // Tarefa que já existe (ex.: proposta pelo briefing e depois assumida no grupo): mescla, não duplica.
        let sameTask: { id: string; status: string; assigneeName: string | null; dueDate: Date | null; sourceEventId: string | null } | null = null;
        if (decision.task && e.type === 'task') {
          const open = await tx.projectTask.findMany({ where: { projectId, status: { in: ['open', 'proposed'] } } });
          sameTask = matchTaskTitle(open, e.title);
          // Mesclado: a revisão (se ainda houver) segue na tarefa existente, não neste evento.
          if (sameTask) review = 'auto_applied';
        }

        // Pagamento de despesa já lançada: a revisão segue no lançamento existente, não neste evento.
        const amount = e.type === 'expense' || e.type === 'payment_proof' ? e.amountCents : null;
        const matched = decision.matchExisting ? await this.matchOpenExpense(tx, projectId, amount) : null;
        if (matched) review = 'auto_applied';

        const event = await tx.projectEvent.create({ data: { ...base, reviewStatus: review } });

        if (sameTask && e.type === 'task') {
          await tx.projectTask.update({
            where: { id: sameTask.id },
            data: {
              // Compromisso assumido promove a proposta; sugestão repetida não rebaixa nada.
              status: decision.task === 'open' ? 'open' : undefined,
              assigneeName: sameTask.assigneeName ?? e.assigneeName,
              dueDate: sameTask.dueDate ?? (e.dueDate ? new Date(`${e.dueDate}T00:00:00.000Z`) : null),
              // Só vincula ao promover: uma proposta do briefing continua contando como "para revisar".
              sourceEventId: decision.task === 'open' ? (sameTask.sourceEventId ?? event.id) : undefined,
            },
          });
          // A proposta original (se veio de um evento) foi resolvida por este compromisso.
          if (decision.task === 'open' && sameTask.status === 'proposed' && sameTask.sourceEventId) {
            await tx.projectEvent.updateMany({
              where: { id: sameTask.sourceEventId, reviewStatus: 'pending_review' },
              data: { reviewStatus: 'confirmed', reviewedByPhone: ctx.senderPhone, reviewedAt: now },
            });
          }
        } else if (decision.task && e.type === 'task') {
          await tx.projectTask.create({
            data: {
              organizationId: ctx.organizationId,
              projectId,
              title: e.title,
              assigneeName: e.assigneeName,
              dueDate: e.dueDate ? new Date(`${e.dueDate}T00:00:00.000Z`) : null,
              status: decision.task,
              sourceEventId: event.id,
              sourceMessageId: ctx.messageId,
            },
          });
        }
        if (doneTaskId) {
          await tx.projectTask.update({ where: { id: doneTaskId }, data: { status: 'done', completedAt: now } });
        }
        if (decision.decision && e.type === 'decision') {
          await tx.projectDecision.create({
            data: { organizationId: ctx.organizationId, projectId, summary: e.summary, sourceEventId: event.id, sourceMessageId: ctx.messageId, decidedAt: now },
          });
        }
        if (decision.expense && (e.type === 'quote' || e.type === 'expense' || e.type === 'payment_proof')) {
          const proof = decision.expense.withProof ? { proofSha256: proofSha, proofAttachmentId: ctx.attachment?.id ?? null } : {};
          const status = decision.expense.status;
          const confirmed = status === 'confirmed' || status === 'paid';
          if (matched) {
            // Pagamento de uma despesa já lançada: o status só avança (proposta → confirmada → paga).
            const rank = { proposed: 0, confirmed: 1, paid: 2, rejected: -1 } as const;
            const next = rank[status] > rank[matched.status] ? status : matched.status;
            await tx.projectExpense.update({
              where: { id: matched.id },
              data: {
                ...proof,
                status: next,
                paidAt: next === 'paid' ? (matched.paidAt ?? now) : matched.paidAt,
                confirmedByPhone: confirmed ? ctx.senderPhone : matched.confirmedByPhone,
                confirmedAt: confirmed ? (matched.confirmedAt ?? now) : matched.confirmedAt,
              },
            });
          } else {
            await tx.projectExpense.create({
              data: {
                organizationId: ctx.organizationId,
                projectId,
                kind: decision.expense.kind,
                description: e.description,
                vendor: e.type === 'payment_proof' ? null : e.vendor,
                amountCents: e.amountCents,
                currency: e.currency,
                status,
                sourceEventId: event.id,
                sourceMessageId: ctx.messageId,
                ...proof,
                confirmedByPhone: confirmed ? ctx.senderPhone : null,
                confirmedAt: confirmed ? now : null,
                paidAt: status === 'paid' ? now : null,
              },
            });
          }
        }
        await audit(tx, ctx.organizationId, actor, `project.event_${review}`, 'project_event', event.id, { after: { type: e.type } });
        return { action: `${e.type}:${review}`, close: decision.close };
      });
    } catch (err) {
      // Mesmo evento desta mensagem já registrado (reenvio/reprocessamento): nada a fazer.
      if (isUniqueViolation(err)) return { action: `${e.type}:duplicate` };
      throw err;
    }
  }

  /** Despesa em aberto do projeto com o mesmo valor (o comprovante a quita). Só casa se for única. */
  private async matchOpenExpense(tx: Tx, projectId: string, amountCents: number | null) {
    if (amountCents === null) return null;
    const candidates = await tx.projectExpense.findMany({
      where: { projectId, kind: 'expense', status: { in: ['proposed', 'confirmed'] }, amountCents, proofSha256: null },
    });
    return candidates.length === 1 ? candidates[0]! : null;
  }

  private async findProofUse(organizationId: string, sha256: string): Promise<string | null> {
    const expense = await this.db.projectExpense.findFirst({ where: { organizationId, proofSha256: sha256 }, include: { project: true } });
    if (expense) {
      const amount = expense.amountCents === null ? '' : `, ${formatBRL(expense.amountCents)}`;
      return `${expense.description}${amount} — ${expense.project.title}`;
    }
    const bill = await this.db.paymentAttachment.findFirst({
      where: { organizationId, sha256 },
      include: { billOccurrence: { include: { recurringBill: true } } },
    });
    return bill ? `conta de ${bill.billOccurrence.recurringBill.name}, ${bill.billOccurrence.competence}` : null;
  }

  // ───────────── encerramento ─────────────

  private async requestClose(ctx: GroupMessageContext, projectId: string, isManager: boolean, actor: Actor, now: Date) {
    if (!isManager || !ctx.senderPhone) {
      return { reply: 'Só quem coordena projetos pode encerrar este workspace.', action: 'close_not_authorized' };
    }
    try {
      const preview = await this.projects.startClosing(ctx.organizationId, projectId, actor, now);
      await this.db.$transaction(async (tx) => {
        await tx.pendingAction.updateMany({ where: { conversationId: ctx.conversationId, status: 'pending' }, data: { status: 'expired', resolvedAt: now } });
        await tx.pendingAction.create({
          data: {
            organizationId: ctx.organizationId,
            conversationId: ctx.conversationId,
            requestedByPhone: ctx.senderPhone!,
            kind: 'project.close',
            payload: { projectId },
            summary: 'Encerrar o projeto',
            expiresAt: new Date(now.getTime() + CLOSE_CONFIRM_TTL_MS),
            sourceMessageId: ctx.messageId,
          },
        });
      });
      return { reply: preview, action: 'close_pending' };
    } catch (err) {
      if (err instanceof DomainError) return { reply: err.message, action: `close_error:${err.code}` };
      throw err;
    }
  }

  private async resolvePending(ctx: GroupMessageContext, projectId: string, confirmed: boolean, actor: Actor, now: Date) {
    const pending = await this.db.pendingAction.findFirst({
      where: { conversationId: ctx.conversationId, status: 'pending', kind: 'project.close' },
      orderBy: { createdAt: 'desc' },
    });
    // Comando sensível no grupo: só o participante que pediu pode confirmar.
    if (!pending || pending.requestedByPhone !== ctx.senderPhone) return null;
    if (pending.expiresAt < now) {
      await this.db.pendingAction.update({ where: { id: pending.id }, data: { status: 'expired', resolvedAt: now } });
      await this.projects.cancelClosing(ctx.organizationId, projectId, actor);
      return { reply: 'O pedido de encerramento expirou. Se ainda quiser, escreva "encerrado" de novo.', action: 'close_expired' };
    }
    const { count } = await this.db.pendingAction.updateMany({
      where: { id: pending.id, status: 'pending' },
      data: { status: confirmed ? 'confirmed' : 'cancelled', resolvedAt: now },
    });
    if (count === 0) return { reply: null, action: 'pending_already_resolved' };
    if (!confirmed) {
      await this.projects.cancelClosing(ctx.organizationId, projectId, actor);
      return { reply: 'Ok, o projeto continua ativo.', action: 'close_declined' };
    }
    try {
      const { report } = await this.projects.close(ctx.organizationId, projectId, actor, now);
      return { reply: report, action: 'project_closed' };
    } catch (err) {
      if (err instanceof DomainError) return { reply: err.message, action: `close_error:${err.code}` };
      throw err;
    }
  }
}

function attachmentKind(kind: string | undefined | null): ContextMessage['attachmentKind'] {
  return kind === 'audio' || kind === 'image' || kind === 'document' || kind === 'video' ? kind : null;
}

function metaColumns(meta: AiExecutionMeta, aiExecutionId: string) {
  return { aiExecutionId, model: meta.model, promptVersion: meta.promptVersion, parserVersion: meta.parserVersion };
}

/** Registra custo e versões de cada chamada à IA (tokens, latência, prompt). */
export async function recordAiExecution(
  db: Db,
  organizationId: string,
  operation: string,
  meta: AiExecutionMeta,
  request: unknown,
  sourceMessageId: string,
): Promise<string> {
  const exec = await db.aiExecution.create({
    data: {
      organizationId,
      operation,
      status: 'succeeded',
      model: meta.model,
      promptVersion: meta.promptVersion,
      parserVersion: meta.parserVersion,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      latencyMs: meta.latencyMs,
      requestHash: stableHash(request),
      sourceMessageId,
    },
  });
  return exec.id;
}
