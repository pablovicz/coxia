import type { NotificationKind } from '@coxia/database';
import { enqueueDelivery, isUniqueViolation } from '@coxia/database';
import { addDays, formatBRL, formatShortDate, formatTimeRange, type IsoDate, localDateOf, localDayBoundsUtc } from '@coxia/shared';
import { DateTime } from 'luxon';
import { BillingService } from './bills';
import { composeMorningBriefing, loadBriefingState } from './briefing';
import { type Db, fromIsoDate, getOrganization, toIsoDate } from './common';
import { ReminderService } from './reminders';

/**
 * Planejamento de notificações — função pura: dado o estado e o "agora", decide o que deve sair.
 * A deduplicação (dedupeKey) garante que cada aviso saia uma única vez, mesmo com o job
 * rodando a cada minuto ou em várias réplicas.
 *
 * Política anti-spam:
 * - Quem recebe o briefing matinal já vê nele contas e reservas do dia/seguinte:
 *   avisos separados de conta e de véspera de reserva vão só para quem NÃO recebe o briefing.
 * - Contas atrasadas são reavisadas a cada `overdueEveryDays` dias.
 * - Avisos diários só saem a partir do horário do briefing (nada de mensagem de madrugada).
 */
export interface PlannerInput {
  now: Date;
  timezone: string;
  briefingTime: string; // HH:mm
  briefingRecipients: string[];
  briefingText: () => string;
  bookingsTomorrow: Array<{ occurrenceId: string; startAt: Date; endAt: Date; spaceName: string; title: string | null; responsiblePhone: string | null }>;
  bookingsSoon: Array<{ occurrenceId: string; startAt: Date; endAt: Date; spaceName: string; title: string | null; responsiblePhone: string | null; notifyOneHourBefore: boolean }>;
  bills: Array<{
    occurrenceId: string;
    name: string;
    competence: string;
    dueDate: IsoDate;
    expectedCents: number | null;
    paidCents: number;
    status: string;
    recipientPhones: string[];
    overdueEveryDays: number;
    lastOverdueNoticeAt: Date | null;
  }>;
  remindersDue: Array<{ id: string; title: string; message: string | null; recipientPhones: string[]; runAt: Date }>;
}

export interface PlannedNotification {
  kind: NotificationKind;
  dedupeKey: string;
  targetType: string;
  targetId: string;
  recipients: string[];
  text: string;
}

const UNPAID = new Set(['pending', 'partially_paid', 'overdue']);

export function planNotifications(input: PlannerInput): PlannedNotification[] {
  const tz = input.timezone;
  const local = DateTime.fromJSDate(input.now, { zone: tz });
  const today = local.toISODate()!;
  const tomorrow = addDays(today, 1);
  const dailyWindowOpen = local.toFormat('HH:mm') >= input.briefingTime;
  const briefed = new Set(input.briefingRecipients);
  const notBriefed = (phones: Array<string | null>) => [...new Set(phones.filter((p): p is string => !!p && !briefed.has(p)))];
  const out: PlannedNotification[] = [];

  if (dailyWindowOpen) {
    if (input.briefingRecipients.length) {
      out.push({
        kind: 'morning_briefing',
        dedupeKey: `morning_briefing:${today}`,
        targetType: 'organization',
        targetId: today,
        recipients: [...briefed],
        text: input.briefingText(),
      });
    }

    for (const b of input.bookingsTomorrow) {
      const recipients = notBriefed([b.responsiblePhone]);
      if (!recipients.length) continue;
      out.push({
        kind: 'booking_day_before',
        dedupeKey: `booking_day_before:${b.occurrenceId}`,
        targetType: 'booking_occurrence',
        targetId: b.occurrenceId,
        recipients,
        text: `Lembrete: amanhã (${formatShortDate(tomorrow)}) você tem a ${b.spaceName} das ${formatTimeRange(b.startAt, b.endAt, tz)}${b.title ? ` — ${b.title}` : ''}.`,
      });
    }

    for (const bill of input.bills) {
      if (!UNPAID.has(bill.status)) continue;
      const recipients = notBriefed(bill.recipientPhones);
      if (!recipients.length) continue;
      const amount = bill.expectedCents === null ? 'valor a confirmar' : formatBRL(Math.max(bill.expectedCents - bill.paidCents, 0));
      if (bill.dueDate === tomorrow) {
        out.push({
          kind: 'bill_day_before',
          dedupeKey: `bill_day_before:${bill.occurrenceId}`,
          targetType: 'bill_occurrence',
          targetId: bill.occurrenceId,
          recipients,
          text: `A conta de ${bill.name} vence amanhã (${formatShortDate(bill.dueDate)}): ${amount}. Quando pagar, me mande o comprovante.`,
        });
      } else if (bill.dueDate === today) {
        out.push({
          kind: 'bill_due_today',
          dedupeKey: `bill_due_today:${bill.occurrenceId}`,
          targetType: 'bill_occurrence',
          targetId: bill.occurrenceId,
          recipients,
          text: `A conta de ${bill.name} vence hoje: ${amount}. Se já pagou, me mande o comprovante.`,
        });
      } else if (bill.dueDate < today) {
        const last = bill.lastOverdueNoticeAt ? localDateOf(bill.lastOverdueNoticeAt, tz) : null;
        if (last && addDays(last, bill.overdueEveryDays) > today) continue;
        out.push({
          kind: 'bill_overdue',
          dedupeKey: `bill_overdue:${bill.occurrenceId}:${today}`,
          targetType: 'bill_occurrence',
          targetId: bill.occurrenceId,
          recipients,
          text: `A conta de ${bill.name} está atrasada desde ${formatShortDate(bill.dueDate)}: ${amount} em aberto.`,
        });
      }
    }
  }

  for (const b of input.bookingsSoon) {
    if (!b.notifyOneHourBefore || !b.responsiblePhone) continue;
    const minutes = (b.startAt.getTime() - input.now.getTime()) / 60_000;
    if (minutes <= 0 || minutes > 60) continue;
    out.push({
      kind: 'booking_one_hour_before',
      dedupeKey: `booking_one_hour_before:${b.occurrenceId}`,
      targetType: 'booking_occurrence',
      targetId: b.occurrenceId,
      recipients: [b.responsiblePhone],
      text: `Daqui a pouco: ${b.spaceName}, ${formatTimeRange(b.startAt, b.endAt, tz)}${b.title ? ` — ${b.title}` : ''}.`,
    });
  }

  for (const r of input.remindersDue) {
    if (!r.recipientPhones.length) continue;
    out.push({
      kind: 'ad_hoc',
      dedupeKey: `reminder:${r.id}:${r.runAt.toISOString()}`,
      targetType: 'reminder',
      targetId: r.id,
      recipients: [...new Set(r.recipientPhones)],
      text: r.message ? `Lembrete: ${r.title}\n${r.message}` : `Lembrete: ${r.title}`,
    });
  }
  return out;
}

/** Executa o planejamento de uma organização e grava agenda + outbox de forma idempotente. */
export class NotificationService {
  private readonly billing: BillingService;
  private readonly reminders: ReminderService;

  constructor(private readonly db: Db) {
    this.billing = new BillingService(db);
    this.reminders = new ReminderService(db);
  }

  async run(organizationId: string, now = new Date()): Promise<string[]> {
    const org = await getOrganization(this.db, organizationId);
    const tz = org.timezone;
    const today = localDateOf(now, tz);
    const tomorrowBounds = localDayBoundsUtc(addDays(today, 1), tz);

    await this.billing.markOverdue(organizationId, now);

    const [members, bookingsTomorrow, bookingsSoon, bills, remindersDue] = await Promise.all([
      this.db.organizationMember.findMany({
        where: { organizationId, receivesMorningBriefing: true, user: { phone: { not: null } } },
        select: { user: { select: { phone: true } } },
      }),
      this.db.bookingOccurrence.findMany({
        where: { organizationId, status: { not: 'cancelled' }, startAt: { gte: tomorrowBounds.start, lt: tomorrowBounds.end } },
        include: { booking: true, space: true },
      }),
      this.db.bookingOccurrence.findMany({
        where: {
          organizationId,
          status: { not: 'cancelled' },
          startAt: { gt: now, lte: new Date(now.getTime() + 60 * 60_000) },
          booking: { notifyOneHourBefore: true },
        },
        include: { booking: true, space: true },
      }),
      this.db.billOccurrence.findMany({
        where: { organizationId, status: { in: ['pending', 'partially_paid', 'overdue'] }, dueDate: { lte: fromIsoDate(addDays(today, 1)) } },
        include: { recurringBill: true },
      }),
      this.reminders.due(organizationId, now),
    ]);

    const briefingRecipients = members.map((m) => m.user.phone!);
    let briefingText: string | null = null;
    const state = await loadBriefingState(this.db, organizationId, today);

    const planned = planNotifications({
      now,
      timezone: tz,
      briefingTime: org.morningBriefingTime,
      briefingRecipients,
      briefingText: () => (briefingText ??= composeMorningBriefing(state)),
      bookingsTomorrow: bookingsTomorrow.map((o) => ({
        occurrenceId: o.id,
        startAt: o.startAt,
        endAt: o.endAt,
        spaceName: o.space.name,
        title: o.booking.title,
        responsiblePhone: o.booking.responsiblePhone,
      })),
      bookingsSoon: bookingsSoon.map((o) => ({
        occurrenceId: o.id,
        startAt: o.startAt,
        endAt: o.endAt,
        spaceName: o.space.name,
        title: o.booking.title,
        responsiblePhone: o.booking.responsiblePhone,
        notifyOneHourBefore: o.booking.notifyOneHourBefore,
      })),
      bills: bills.map((b) => ({
        occurrenceId: b.id,
        name: b.recurringBill.name,
        competence: b.competence,
        dueDate: toIsoDate(b.dueDate),
        expectedCents: b.expectedAmountCents,
        paidCents: b.paidAmountCents,
        status: b.status,
        recipientPhones: b.recurringBill.recipientPhones,
        overdueEveryDays: b.recurringBill.overdueReminderEveryDays,
        lastOverdueNoticeAt: b.lastOverdueNoticeAt,
      })),
      remindersDue: remindersDue.map((r) => ({ id: r.id, title: r.title, message: r.message, recipientPhones: r.recipientPhones, runAt: r.nextRunAt! })),
    });

    const created: string[] = [];
    for (const p of planned) {
      const dedupeKey = `${organizationId}:${p.dedupeKey}`;
      try {
        await this.db.$transaction(async (tx) => {
          const schedule = await tx.notificationSchedule.create({
            data: { organizationId, kind: p.kind, targetType: p.targetType, targetId: p.targetId, scheduledFor: now, dedupeKey, status: 'enqueued' },
          });
          for (const recipient of p.recipients) {
            await enqueueDelivery(tx, { organizationId, recipient, text: p.text, idempotencyKey: `${dedupeKey}:${recipient}`, scheduleId: schedule.id });
          }
          if (p.kind === 'bill_overdue') {
            await tx.billOccurrence.update({ where: { id: p.targetId }, data: { lastOverdueNoticeAt: now } });
          }
          if (p.targetType === 'reminder') {
            await this.reminders.advance(tx, organizationId, p.targetId, now);
          }
        });
        created.push(p.dedupeKey);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // já planejado antes: nada a fazer
      }
    }
    return created;
  }
}
