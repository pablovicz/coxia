import { addDays, expandDates, localDateOf, parseRRule, zonedToUtc } from '@coxia/shared';
import { DateTime } from 'luxon';
import { AppointmentService } from './appointments';
import { type Db, DomainError, fromIsoDate, getOrganization, toIsoDate } from './common';
import { reminderPerson } from './reminders';

/** Uma ocorrência de lembrete no calendário (os recorrentes viram uma por dia em que disparam). */
export interface CalendarReminder {
  reminderId: string;
  /** Instante desta ocorrência. */
  at: string;
  type: 'general' | 'call' | 'message';
  title: string;
  message: string | null;
  recurrenceRule: string | null;
  person: { name: string | null; phone: string | null };
  recipientPhones: string[];
  /** Já disparou (ou foi concluído). */
  done: boolean;
  /** Ainda pode ser concluído/encerrado. */
  active: boolean;
}

export interface CalendarBill {
  occurrenceId: string;
  billId: string;
  name: string;
  dueDate: string;
  status: string;
  expectedAmountCents: number | null;
  paidAmountCents: number;
  isVariableAmount: boolean;
  lateFeeCents: number | null;
  category: { id: string; name: string; icon: string; color: string } | null;
}

/** Até ~13 meses por consulta (visão anual com folga). */
const MAX_RANGE_DAYS = 400;
/** Teto de ocorrências por lembrete recorrente (um "todo dia" num ano inteiro cabe). */
const MAX_RUNS_PER_REMINDER = 400;

/**
 * Calendário da equipe, separado da agenda das salas: compromissos, lembretes e contas
 * num período [from, to).
 */
export class CalendarService {
  private readonly appointments: AppointmentService;

  constructor(private readonly db: Db) {
    this.appointments = new AppointmentService(db);
  }

  async range(organizationId: string, from: Date, to: Date) {
    if (!(to > from)) throw new DomainError('validation', 'Período inválido');
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) throw new DomainError('validation', 'Período longo demais');
    const org = await getOrganization(this.db, organizationId);
    const tz = org.timezone;
    const fromDate = localDateOf(from, tz);
    // Último dia local que encosta no período (to é exclusivo).
    const lastDate = localDateOf(new Date(to.getTime() - 1), tz);

    const [appointments, reminders, bills] = await Promise.all([
      this.appointments.list(organizationId, from, to),
      this.db.reminder.findMany({
        where: {
          organizationId,
          dueAt: { lt: to },
          OR: [{ recurrenceRule: { not: null } }, { dueAt: { gte: from } }],
        },
        include: { contact: { select: { id: true, name: true, whatsappName: true, phone: true } } },
      }),
      this.db.billOccurrence.findMany({
        where: { organizationId, status: { not: 'cancelled' }, dueDate: { gte: fromIsoDate(fromDate), lte: fromIsoDate(lastDate) } },
        include: { recurringBill: { include: { expenseCategory: { select: { id: true, name: true, icon: true, color: true } } } } },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    const reminderRuns: CalendarReminder[] = [];
    for (const r of reminders) {
      if (!r.dueAt) continue;
      const base = {
        reminderId: r.id,
        type: r.type,
        title: r.title,
        message: r.message,
        recurrenceRule: r.recurrenceRule,
        person: reminderPerson(r),
        recipientPhones: r.recipientPhones,
        active: r.active,
      };
      if (!r.recurrenceRule) {
        if (r.dueAt >= from && r.dueAt < to) reminderRuns.push({ ...base, at: r.dueAt.toISOString(), done: !r.active });
        continue;
      }
      let rule;
      try {
        rule = parseRRule(r.recurrenceRule);
      } catch {
        continue;
      }
      const time = DateTime.fromJSDate(r.dueAt, { zone: tz }).toFormat('HH:mm');
      const start = localDateOf(r.dueAt, tz);
      // Encerrado: só aparecem as ocorrências até o último envio.
      const lastSent = r.lastSentAt;
      let runs = 0;
      for (const date of expandDates(rule, start, fromDate > start ? fromDate : start, addDays(lastDate, 1))) {
        const at = zonedToUtc(date, time, tz);
        if (at < from || at >= to) continue;
        if (!r.active && (!lastSent || at > lastSent)) break;
        const done = r.active ? !!r.nextRunAt && at < r.nextRunAt : true;
        reminderRuns.push({ ...base, at: at.toISOString(), done });
        if (++runs >= MAX_RUNS_PER_REMINDER) break;
      }
    }
    reminderRuns.sort((a, b) => a.at.localeCompare(b.at));

    const billItems: CalendarBill[] = bills.map((b) => ({
      occurrenceId: b.id,
      billId: b.recurringBillId,
      name: b.recurringBill.name,
      dueDate: toIsoDate(b.dueDate),
      status: b.status,
      expectedAmountCents: b.expectedAmountCents,
      paidAmountCents: b.paidAmountCents,
      isVariableAmount: b.recurringBill.isVariableAmount,
      lateFeeCents: b.recurringBill.lateFeeCents,
      category: b.recurringBill.expenseCategory,
    }));

    return { appointments, reminders: reminderRuns, bills: billItems };
  }
}
