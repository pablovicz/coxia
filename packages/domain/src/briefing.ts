import {
  addDays,
  formatBRL,
  formatHour,
  formatLongDate,
  formatShortDate,
  formatTimeRange,
  type IsoDate,
  localDayBoundsUtc,
} from '@coxia/shared';
import { type Db, fromIsoDate, getOrganization, toIsoDate } from './common';

/** Estado estruturado do briefing — o texto é gerado a partir dele, nunca relendo conversas. */
export interface BriefingState {
  organizationName: string;
  date: IsoDate;
  timezone: string;
  today: BriefingBooking[];
  tomorrow: BriefingBooking[];
  billsDueToday: BriefingBill[];
  billsDueTomorrow: BriefingBill[];
  billsOverdue: BriefingBill[];
  remindersToday: Array<{ title: string; at: Date }>;
  /** Pendências de projetos ativos (Etapa 3). */
  projects: Array<{ title: string; openTasks: number; overdueTasks: number; toReview: number }>;
}

export interface BriefingBooking {
  spaceName: string;
  startAt: Date;
  endAt: Date;
  title: string | null;
  responsibleName: string | null;
}

export interface BriefingBill {
  name: string;
  dueDate: IsoDate;
  expectedCents: number | null;
  paidCents: number;
}

function bookingLine(b: BriefingBooking, tz: string): string {
  const who = b.responsibleName ? ` (${b.responsibleName})` : '';
  const what = b.title ? ` · ${b.title}` : '';
  return `• ${formatTimeRange(b.startAt, b.endAt, tz)} · ${b.spaceName}${what}${who}`;
}

function billAmount(b: BriefingBill): string {
  if (b.expectedCents === null) return 'valor a confirmar';
  const open = b.expectedCents - b.paidCents;
  return b.paidCents > 0 ? `${formatBRL(open)} restantes` : formatBRL(b.expectedCents);
}

/**
 * Texto do briefing matinal. Tom caloroso e breve; sem emojis em finanças.
 * Seções vazias são omitidas; se não houver nada, uma frase curta.
 */
export function composeMorningBriefing(s: BriefingState, greeting = 'Bom dia!'): string {
  const tz = s.timezone;
  const lines: string[] = [`${greeting} Resumo de ${formatLongDate(s.date)} — ${s.organizationName}`];
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push('', `*${title}*`, ...items);
  };

  section('Agenda de hoje', s.today.map((b) => bookingLine(b, tz)));
  section(`Amanhã (${formatShortDate(addDays(s.date, 1))})`, s.tomorrow.map((b) => bookingLine(b, tz)));
  section('Contas', [
    ...s.billsOverdue.map((b) => `• Atrasada desde ${formatShortDate(b.dueDate)}: ${b.name} — ${billAmount(b)}`),
    ...s.billsDueToday.map((b) => `• Vence hoje: ${b.name} — ${billAmount(b)}`),
    ...s.billsDueTomorrow.map((b) => `• Vence amanhã: ${b.name} — ${billAmount(b)}`),
  ]);
  section('Lembretes de hoje', s.remindersToday.map((r) => `• ${formatHour(r.at, tz)} · ${r.title}`));
  section(
    'Projetos',
    s.projects
      .filter((p) => p.openTasks > 0 || p.toReview > 0)
      .map((p) => {
        const parts = [
          p.openTasks ? `${p.openTasks} pendência${p.openTasks > 1 ? 's' : ''}` : null,
          p.overdueTasks ? `${p.overdueTasks} atrasada${p.overdueTasks > 1 ? 's' : ''}` : null,
          p.toReview ? `${p.toReview} para revisar` : null,
        ].filter(Boolean);
        return `• ${p.title}: ${parts.join(', ')}`;
      }),
  );

  if (lines.length === 1) lines.push('', 'Nenhuma reserva hoje e nenhuma conta pendente. Bom trabalho!');
  else if (s.today.length === 0) lines.splice(1, 0, '', 'Nenhuma reserva hoje.');
  return lines.join('\n');
}

/** Carrega o estado do briefing para o dia local `date`. */
export async function loadBriefingState(db: Db, organizationId: string, date: IsoDate): Promise<BriefingState> {
  const org = await getOrganization(db, organizationId);
  const tz = org.timezone;
  const today = localDayBoundsUtc(date, tz);
  const tomorrow = localDayBoundsUtc(addDays(date, 1), tz);

  const [occurrences, bills, reminders, projects] = await Promise.all([
    db.bookingOccurrence.findMany({
      where: { organizationId, status: { not: 'cancelled' }, startAt: { gte: today.start, lt: tomorrow.end } },
      include: { booking: true, space: true },
      orderBy: [{ startAt: 'asc' }, { space: { sortOrder: 'asc' } }],
    }),
    db.billOccurrence.findMany({
      where: {
        organizationId,
        status: { in: ['pending', 'partially_paid', 'overdue'] },
        dueDate: { lte: fromIsoDate(addDays(date, 1)) },
      },
      include: { recurringBill: true },
      orderBy: { dueDate: 'asc' },
    }),
    db.reminder.findMany({
      where: { organizationId, active: true, nextRunAt: { gte: today.start, lt: today.end } },
      orderBy: { nextRunAt: 'asc' },
    }),
    db.project.findMany({
      where: { organizationId, status: { in: ['active', 'closing'] } },
      include: {
        tasks: { where: { status: { in: ['open', 'proposed'] } }, select: { dueDate: true, status: true, sourceEventId: true } },
        _count: { select: { events: { where: { reviewStatus: 'pending_review' } } } },
      },
      orderBy: { title: 'asc' },
    }),
  ]);

  const toBooking = (o: (typeof occurrences)[number]): BriefingBooking => ({
    spaceName: o.space.name,
    startAt: o.startAt,
    endAt: o.endAt,
    title: o.booking.title,
    responsibleName: o.booking.responsibleName,
  });
  const toBill = (o: (typeof bills)[number]): BriefingBill => ({
    name: o.recurringBill.name,
    dueDate: toIsoDate(o.dueDate),
    expectedCents: o.expectedAmountCents,
    paidCents: o.paidAmountCents,
  });

  return {
    organizationName: org.name,
    date,
    timezone: tz,
    today: occurrences.filter((o) => o.startAt < today.end).map(toBooking),
    tomorrow: occurrences.filter((o) => o.startAt >= tomorrow.start).map(toBooking),
    billsOverdue: bills.filter((b) => toIsoDate(b.dueDate) < date).map(toBill),
    billsDueToday: bills.filter((b) => toIsoDate(b.dueDate) === date).map(toBill),
    billsDueTomorrow: bills.filter((b) => toIsoDate(b.dueDate) === addDays(date, 1)).map(toBill),
    remindersToday: reminders.map((r) => ({ title: r.title, at: r.nextRunAt! })),
    projects: projects.map((p) => ({
      title: p.title,
      openTasks: p.tasks.filter((t) => t.status === 'open').length,
      overdueTasks: p.tasks.filter((t) => t.status === 'open' && t.dueDate && toIsoDate(t.dueDate) < date).length,
      toReview: p._count.events + p.tasks.filter((t) => t.status === 'proposed' && !t.sourceEventId).length,
    })),
  };
}
