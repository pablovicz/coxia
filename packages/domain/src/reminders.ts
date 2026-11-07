import { addDays, expandDates, localDateOf, parseRRule, zonedToUtc } from '@coxia/shared';
import { DateTime } from 'luxon';
import { type Actor, audit, type Db, DomainError, getOrganization, type Tx } from './common';

export interface ReminderInput {
  title: string;
  message?: string | null;
  /** Primeira execução (instante). */
  dueAt: Date;
  /** RRULE semanal/mensal; ausente = lembrete único. */
  recurrenceRule?: string | null;
  recipientPhones: string[];
}

/**
 * Próxima execução de um lembrete recorrente depois de `after`, mantendo o horário local da
 * primeira execução. Retorna null se a regra terminou.
 */
export function nextReminderRun(rule: string, firstRun: Date, after: Date, timezone: string): Date | null {
  const parsed = parseRRule(rule);
  const startDate = localDateOf(firstRun, timezone);
  const time = DateTime.fromJSDate(firstRun, { zone: timezone }).toFormat('HH:mm');
  const fromDate = localDateOf(after, timezone);
  for (const date of expandDates(parsed, startDate, fromDate, addDays(fromDate, 400))) {
    const run = zonedToUtc(date, time, timezone);
    if (run > after) return run;
  }
  return null;
}

export class ReminderService {
  constructor(private readonly db: Db) {}

  list(organizationId: string) {
    return this.db.reminder.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }] });
  }

  async create(organizationId: string, input: ReminderInput, actor: Actor) {
    if (!input.title.trim()) throw new DomainError('validation', 'Informe o título do lembrete');
    if (input.recipientPhones.length === 0) throw new DomainError('validation', 'Informe ao menos um destinatário');
    if (input.recurrenceRule) {
      try {
        parseRRule(input.recurrenceRule);
      } catch (e) {
        throw new DomainError('validation', `Recorrência inválida: ${(e as Error).message}`);
      }
    }
    return this.db.$transaction(async (tx) => {
      const reminder = await tx.reminder.create({
        data: {
          organizationId,
          kind: input.recurrenceRule ? 'recurring' : 'one_time',
          title: input.title.trim(),
          message: input.message?.trim() || null,
          dueAt: input.dueAt,
          recurrenceRule: input.recurrenceRule ?? null,
          nextRunAt: input.dueAt,
          recipientPhones: input.recipientPhones,
        },
      });
      await audit(tx, organizationId, actor, 'reminder.create', 'reminder', reminder.id, { after: reminder });
      return reminder;
    });
  }

  async deactivate(organizationId: string, reminderId: string, actor: Actor) {
    const r = await this.db.reminder.findFirst({ where: { id: reminderId, organizationId } });
    if (!r) throw new DomainError('not_found', 'Lembrete não encontrado');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.reminder.update({ where: { id: reminderId }, data: { active: false, nextRunAt: null } });
      await audit(tx, organizationId, actor, 'reminder.deactivate', 'reminder', reminderId);
      return updated;
    });
  }

  due(organizationId: string, now: Date) {
    return this.db.reminder.findMany({ where: { organizationId, active: true, nextRunAt: { lte: now } } });
  }

  /** Após enviar: único → desativa; recorrente → agenda o próximo. */
  async advance(tx: Tx, organizationId: string, reminderId: string, sentAt: Date) {
    const org = await getOrganization(tx, organizationId);
    const r = await tx.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    const next = r.recurrenceRule && r.dueAt ? nextReminderRun(r.recurrenceRule, r.dueAt, sentAt, org.timezone) : null;
    await tx.reminder.update({
      where: { id: reminderId },
      data: { lastSentAt: sentAt, nextRunAt: next, active: next !== null },
    });
  }
}
