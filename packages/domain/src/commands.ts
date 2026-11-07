import type { CommandIntent, InterpretCommandRequest, InterpretCommandResponse } from '@coxia/contracts';
import type { Prisma } from '@coxia/database';
import {
  formatBRL,
  formatCompetence,
  formatShortDate,
  formatTimeRange,
  localDateOf,
  stableHash,
} from '@coxia/shared';
import { BillingService, resolveBillHint } from './bills';
import { BookingService, type Conflict } from './bookings';
import { composeMorningBriefing, loadBriefingState } from './briefing';
import { type Actor, type Db, DomainError, getOrganization } from './common';
import { resolveSpaceHint } from './spaces';

/** Interpretação de linguagem natural (FastAPI). Injetado para permitir stub nos testes. */
export interface CommandInterpreter {
  interpret(req: InterpretCommandRequest, idempotencyKey: string): Promise<InterpretCommandResponse>;
}

export interface CommandContext {
  organizationId: string;
  conversationId: string;
  messageId: string;
  senderPhone: string;
  text: string;
  /** Anexo já copiado para o bucket (comprovante). */
  attachment?: { id: string; sha256: string | null; storageKey: string | null } | null;
  now?: Date;
}

export interface CommandResult {
  /** Texto de resposta para a conversa; null = ficar em silêncio. */
  reply: string | null;
  action: string;
}

const CONFIRM_TTL_MS = 10 * 60_000;
const YES = /^(sim|s|confirmo|confirmar|confirma|pode|pode sim|ok|isso)[.!\s]*$/i;
const NO = /^(n[aã]o|n|deixa|esquece|cancelar n[aã]o)[.!\s]*$/i;
const MIN_CONFIDENCE = 0.5;

const HELP =
  'Posso ajudar com a agenda das salas e as contas. Exemplos:\n' +
  '• "Quais salas estão livres amanhã à tarde?"\n' +
  '• "Reserva a sala grande na sexta das 14h às 17h para a Micaela"\n' +
  '• "Paguei a energia, R$ 310"\n' +
  '• "Resumo de hoje"';

/**
 * Executa comandos de administradoras recebidos por WhatsApp.
 * A IA só interpreta; toda regra (conflito, permissão, valores) é aplicada pelos serviços de domínio.
 * Ações destrutivas pedem confirmação explícita de quem pediu, na mesma conversa.
 */
export class CommandService {
  private readonly bookings: BookingService;
  private readonly billing: BillingService;

  constructor(
    private readonly db: Db,
    private readonly interpreter: CommandInterpreter,
  ) {
    this.bookings = new BookingService(db);
    this.billing = new BillingService(db);
  }

  async handle(ctx: CommandContext): Promise<CommandResult> {
    const now = ctx.now ?? new Date();
    const text = ctx.text.trim();
    const actor: Actor = { channel: 'whatsapp', phone: ctx.senderPhone, sourceMessageId: ctx.messageId };

    // 1. Resposta a uma confirmação pendente?
    if (YES.test(text) || NO.test(text)) {
      const resolved = await this.resolvePending(ctx, YES.test(text), actor, now);
      if (resolved) return resolved;
    }
    if (!text) return { reply: null, action: 'empty' };

    // 2. Interpretação
    const org = await getOrganization(this.db, ctx.organizationId);
    const [spaces, bills] = await Promise.all([
      this.db.space.findMany({ where: { organizationId: org.id, active: true }, orderBy: { sortOrder: 'asc' } }),
      this.db.recurringBill.findMany({ where: { organizationId: org.id, active: true } }),
    ]);
    const res = await this.interpreter.interpret(
      {
        organizationId: org.id,
        timezone: org.timezone,
        now: now.toISOString(),
        text,
        knownSpaces: spaces.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases })),
        knownBills: bills.map((b) => ({ id: b.id, name: b.name })),
      },
      `interpret:${ctx.messageId}`,
    );
    await this.recordAi(org.id, ctx.messageId, res, text);

    if (res.clarificationQuestion) return { reply: res.clarificationQuestion, action: 'clarify' };
    if (res.confidence < MIN_CONFIDENCE) return { reply: `Não tenho certeza do que você pediu. ${HELP}`, action: 'low_confidence' };

    try {
      return await this.execute(res.command, ctx, actor, org.timezone, spaces, now);
    } catch (err) {
      if (err instanceof DomainError) return { reply: friendlyError(err, org.timezone), action: `error:${err.code}` };
      throw err;
    }
  }

  private async execute(
    cmd: CommandIntent,
    ctx: CommandContext,
    actor: Actor,
    tz: string,
    spaces: Array<{ id: string; name: string; slug: string; aliases: string[] }>,
    now: Date,
  ): Promise<CommandResult> {
    switch (cmd.intent) {
      case 'booking.check_availability': {
        const from = new Date(cmd.from);
        const to = new Date(cmd.to);
        let spaceId: string | undefined;
        if (cmd.spaceHint) {
          const r = resolveSpaceHint(spaces, cmd.spaceHint);
          if (!r.match) return { reply: askWhichSpace(r.candidates), action: 'clarify_space' };
          spaceId = r.match.id;
        }
        const date = localDateOf(from, tz);
        const result = await this.bookings.availability(ctx.organizationId, date, { spaceId, window: { start: from, end: to } });
        const lines = result.map((r) =>
          r.free.length ? `• ${r.space.name}: livre ${r.free.map((f) => formatTimeRange(f.start, f.end, tz)).join(', ')}` : `• ${r.space.name}: ocupada`,
        );
        return { reply: `Disponibilidade em ${formatShortDate(date)}, ${formatTimeRange(from, to, tz)}:\n${lines.join('\n')}`, action: 'availability' };
      }

      case 'booking.create': {
        const r = resolveSpaceHint(spaces, cmd.spaceHint);
        if (!r.match) return { reply: askWhichSpace(r.candidates), action: 'clarify_space' };
        const recurrence = cmd.recurrence
          ? { rule: `FREQ=WEEKLY;BYDAY=${cmd.recurrence.byWeekday.map((d) => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][d - 1]).join(',')}` }
          : null;
        const result = await this.bookings.create(
          ctx.organizationId,
          {
            spaceId: r.match.id,
            startAt: new Date(cmd.startAt),
            endAt: new Date(cmd.endAt),
            responsibleName: cmd.responsibleName,
            notes: cmd.notes,
            recurrence,
            onConflict: recurrence ? 'skip' : 'fail',
          },
          actor,
          now,
        );
        const first = result.occurrences[0]!;
        const who = cmd.responsibleName ? ` para ${cmd.responsibleName}` : '';
        if (recurrence) {
          const skipped = result.skipped.length
            ? `\nNão couberam ${result.skipped.length} data(s): ${result.skipped.map((s) => formatShortDate(localDateOf(s.startAt, tz))).join(', ')}.`
            : '';
          return {
            reply: `Série reservada: ${r.match.name}, ${formatTimeRange(first.startAt, first.endAt, tz)}${who}, a partir de ${formatShortDate(localDateOf(first.startAt, tz))} (${result.occurrences.length} datas agendadas).${skipped}`,
            action: 'booking_series_created',
          };
        }
        return {
          reply: `Reservado: ${r.match.name}, ${formatShortDate(localDateOf(first.startAt, tz))}, ${formatTimeRange(first.startAt, first.endAt, tz)}${who}.`,
          action: 'booking_created',
        };
      }

      case 'booking.cancel': {
        let spaceId: string | null = null;
        if (cmd.spaceHint) {
          const r = resolveSpaceHint(spaces, cmd.spaceHint);
          if (!r.match) return { reply: askWhichSpace(r.candidates), action: 'clarify_space' };
          spaceId = r.match.id;
        }
        const candidates = await this.bookings.findAround(ctx.organizationId, new Date(cmd.around), spaceId);
        if (candidates.length === 0) return { reply: 'Não encontrei reserva nesse horário.', action: 'cancel_not_found' };
        if (candidates.length > 1) {
          const list = candidates.map((o) => `• ${o.space.name}, ${formatTimeRange(o.startAt, o.endAt, tz)}${o.booking.responsibleName ? ` (${o.booking.responsibleName})` : ''}`);
          return { reply: `Encontrei mais de uma reserva:\n${list.join('\n')}\nQual delas? Diga a sala.`, action: 'cancel_ambiguous' };
        }
        const occ = candidates[0]!;
        const summary = `${occ.space.name}, ${formatShortDate(localDateOf(occ.startAt, tz))}, ${formatTimeRange(occ.startAt, occ.endAt, tz)}${occ.booking.responsibleName ? ` (${occ.booking.responsibleName})` : ''}`;
        await this.createPending(ctx, 'booking.cancel_occurrence', { occurrenceId: occ.id }, summary, now);
        const seriesNote = occ.booking.recurrenceRule ? ' Só esta data; o restante da série continua.' : '';
        return { reply: `Cancelar a reserva ${summary}?${seriesNote} Responda SIM para confirmar.`, action: 'cancel_pending' };
      }

      case 'bill.mark_paid': {
        const bills = await this.db.recurringBill.findMany({ where: { organizationId: ctx.organizationId, active: true } });
        const r = resolveBillHint(bills, cmd.billHint);
        if (!r.match) {
          return { reply: `Qual conta? ${r.candidates.map((b) => b.name).join(', ')}.`, action: 'clarify_bill' };
        }
        const occ = await this.billing.oldestOpenOccurrence(r.match.id);
        if (!occ) return { reply: `Não há ${r.match.name} em aberto. Está tudo pago.`, action: 'bill_nothing_open' };
        const result = await this.billing.registerPayment(
          ctx.organizationId,
          occ.id,
          {
            amountCents: cmd.amountCents,
            paidOn: cmd.paidOn,
            proof: ctx.attachment ? { sha256: ctx.attachment.sha256, storageKey: ctx.attachment.storageKey, messageAttachmentId: ctx.attachment.id } : null,
          },
          actor,
          now,
        );
        const label = `${r.match.name} de ${formatCompetence(occ.competence)}`;
        const proof = ctx.attachment ? ' Comprovante guardado.' : '';
        if (result.remainingCents > 0) {
          return { reply: `Anotado: pagamento parcial de ${formatBRL(result.amountCents)} em ${label}. Faltam ${formatBRL(result.remainingCents)}.${proof}`, action: 'bill_partial' };
        }
        return { reply: `Anotado: ${label} paga (${formatBRL(result.amountCents)}).${proof}`, action: 'bill_paid' };
      }

      case 'summary.today': {
        const state = await loadBriefingState(this.db, ctx.organizationId, localDateOf(now, tz));
        const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now));
        const greeting = hour >= 5 && hour < 12 ? 'Bom dia!' : hour >= 12 && hour < 18 ? 'Boa tarde!' : 'Boa noite!';
        return { reply: composeMorningBriefing(state, greeting), action: 'summary' };
      }

      case 'project.close':
        return { reply: 'Para encerrar um projeto, escreva "encerrado" no grupo do projeto.', action: 'project_close_redirect' };

      case 'none':
        return { reply: HELP, action: 'help' };
    }
  }

  // ───────────── confirmações ─────────────

  private async createPending(ctx: CommandContext, kind: string, payload: Record<string, unknown>, summary: string, now: Date) {
    await this.db.$transaction(async (tx) => {
      // Um pedido novo substitui o anterior na mesma conversa.
      await tx.pendingAction.updateMany({
        where: { conversationId: ctx.conversationId, status: 'pending' },
        data: { status: 'expired', resolvedAt: now },
      });
      await tx.pendingAction.create({
        data: {
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          requestedByPhone: ctx.senderPhone,
          kind,
          payload: payload as Prisma.InputJsonValue,
          summary,
          expiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
          sourceMessageId: ctx.messageId,
        },
      });
    });
  }

  private async resolvePending(ctx: CommandContext, confirmed: boolean, actor: Actor, now: Date): Promise<CommandResult | null> {
    const pending = await this.db.pendingAction.findFirst({
      where: { conversationId: ctx.conversationId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return null;
    // Só quem pediu pode confirmar.
    if (pending.requestedByPhone !== ctx.senderPhone) return null;
    if (pending.expiresAt < now) {
      await this.db.pendingAction.update({ where: { id: pending.id }, data: { status: 'expired', resolvedAt: now } });
      return { reply: 'Esse pedido expirou. Se ainda quiser, peça de novo.', action: 'pending_expired' };
    }
    // Marca como resolvida antes de executar: um "sim" repetido não executa duas vezes.
    const { count } = await this.db.pendingAction.updateMany({
      where: { id: pending.id, status: 'pending' },
      data: { status: confirmed ? 'confirmed' : 'cancelled', resolvedAt: now },
    });
    if (count === 0) return { reply: null, action: 'pending_already_resolved' };
    if (!confirmed) return { reply: 'Ok, não cancelei nada.', action: 'pending_declined' };

    const payload = pending.payload as Record<string, string>;
    switch (pending.kind) {
      case 'booking.cancel_occurrence':
        await this.bookings.cancelOccurrence(ctx.organizationId, payload.occurrenceId!, actor);
        return { reply: `Cancelada: ${pending.summary}.`, action: 'booking_cancelled' };
      default:
        throw new DomainError('validation', `Ação pendente desconhecida: ${pending.kind}`);
    }
  }

  private async recordAi(organizationId: string, messageId: string, res: InterpretCommandResponse, text: string) {
    await this.db.aiExecution.create({
      data: {
        organizationId,
        operation: 'interpret_command',
        status: 'succeeded',
        model: res.meta.model,
        promptVersion: res.meta.promptVersion,
        parserVersion: res.meta.parserVersion,
        inputTokens: res.meta.inputTokens,
        outputTokens: res.meta.outputTokens,
        latencyMs: res.meta.latencyMs,
        requestHash: stableHash({ text }),
        sourceMessageId: messageId,
      },
    });
  }
}

function askWhichSpace(candidates: Array<{ name: string }>): string {
  return `Qual sala? ${candidates.map((c) => c.name).join(', ')}.`;
}

function friendlyError(err: DomainError, tz: string): string {
  const details = err.details as { conflicts?: Conflict[]; code?: string } | undefined;
  const conflict = details?.conflicts?.[0];
  if (conflict) {
    if (conflict.reason === 'overlap' && conflict.with) {
      const who = conflict.with.responsibleName ? ` (${conflict.with.responsibleName})` : '';
      const what = conflict.with.title ? `"${conflict.with.title}"` : 'uma reserva';
      return `Não consegui reservar: já existe ${what}${who} das ${formatTimeRange(conflict.with.startAt, conflict.with.endAt, tz)}.`;
    }
    if (conflict.reason === 'blocked') return `Não consegui reservar: a sala está bloqueada nesse horário${conflict.block?.reason ? ` (${conflict.block.reason})` : ''}.`;
    if (conflict.reason === 'outside_hours') return 'Não consegui reservar: fora do horário de funcionamento da sala.';
  }
  return err.message.endsWith('.') ? err.message : `${err.message}.`;
}

