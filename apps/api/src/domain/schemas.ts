import { z } from 'zod';
import type { AuthUser } from '../auth/decorators';
import { type Actor, EXPENSE_ICONS, SPACE_COLORS, SPACE_ICONS, SPACE_STATUSES } from '@coxia/domain';

export const isoDateTime = z.string().datetime({ offset: true }).transform((s) => new Date(s));
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:mm');
export const phone = z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().min(10).max(15));
export const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');

export const rangeQuery = z.object({
  from: isoDateTime,
  to: isoDateTime,
  spaceId: z.string().optional(),
});

const weeklySlot = z.object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm });

/**
 * Reserva pelo painel: única (startAt/endAt, com ou sem `recurrence`) ou semanal em vários dias
 * com horário por dia (`weekly`). Sempre com quem vai usar a sala: contato ou nome + telefone.
 */
export const createBookingSchema = z
  .object({
  spaceId: z.string().min(1),
  startAt: isoDateTime.optional(),
  endAt: isoDateTime.optional(),
  weekly: z.object({ startsOn: isoDate, until: isoDate.nullish(), slots: z.array(weeklySlot).min(1).max(7) }).nullish(),
  title: z.string().max(120).nullish(),
  contactId: z.string().nullish(),
  responsibleName: z.string().max(120).nullish(),
  responsiblePhone: phone.nullish(),
  hourlyRateCents: z.number().int().positive().nullish(),
  notes: z.string().max(1000).nullish(),
  status: z.enum(['confirmed', 'tentative']).optional(),
  recurrence: z.object({ rule: z.string().min(5), until: isoDate.nullish() }).nullish(),
  notifyOneHourBefore: z.boolean().optional(),
  onConflict: z.enum(['fail', 'skip']).optional(),
})
  .refine((b) => !!b.weekly || (!!b.startAt && !!b.endAt), { message: 'Informe início e fim, ou os dias da semana', path: ['startAt'] })
  .refine((b) => !!b.contactId || (!!b.responsibleName?.trim() && !!b.responsiblePhone), {
    message: 'Informe o nome e o telefone de quem vai usar a sala',
    path: ['responsiblePhone'],
  });

export const updateOccurrenceSchema = z.object({
  startAt: isoDateTime,
  endAt: isoDateTime,
  spaceId: z.string().optional(),
});

export const updateSeriesSchema = z.object({
  localStartTime: hhmm,
  localEndTime: hhmm,
  fromDate: isoDate,
  onConflict: z.enum(['fail', 'skip']).optional(),
});

export const cancelSeriesSchema = z.object({ fromDate: isoDate, wholeGroup: z.boolean().optional() });

export const spaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).nullish(),
  aliases: z.array(z.string().max(40)).max(10).optional(),
  capacity: z.number().int().positive().nullish(),
  sortOrder: z.number().int().optional(),
  status: z.enum(SPACE_STATUSES).optional(),
  color: z.enum(SPACE_COLORS).optional(),
  icon: z.enum(SPACE_ICONS).optional(),
  hourlyRateCents: z.number().int().positive().nullish(),
  rentAmountCents: z.number().int().positive().nullish(),
  rentDueDay: z.number().int().min(1).max(31).nullish(),
  tenantName: z.string().max(120).nullish(),
});

const openingRule = z.object({ weekday: z.number().int().min(1).max(7), opensAt: hhmm, closesAt: hhmm });

export const availabilitySchema = z.object({
  rules: z.array(openingRule).max(21),
});

/** Criação: os dados da sala e, opcionalmente, o horário (senão, seg–sáb 08:00–22:00). */
export const createSpaceSchema = spaceSchema.extend({ availability: z.array(openingRule).max(21).optional() });

export const blockSchema = z.object({ startAt: isoDateTime, endAt: isoDateTime, reason: z.string().max(200).nullish() });

export const billSchema = z.object({
  name: z.string().min(1).max(80),
  /** Mensal (vencimento todo mês) ou pontual (uma data em `dueOn`). */
  kind: z.enum(['monthly', 'one_time']).optional(),
  /** Uso interno; quando não vem, é deduzido do nome. */
  category: z.enum(['aluguel', 'energia', 'agua', 'internet', 'telefone', 'outros']).optional(),
  expenseCategoryId: z.string().nullish(),
  lateFeeCents: z.number().int().nonnegative().nullish(),
  dueOn: isoDate.nullish(),
  dueDay: z.number().int().min(1).max(31),
  estimatedAmountCents: z.number().int().nonnegative().nullish(),
  isVariableAmount: z.boolean().optional(),
  responsibleName: z.string().max(120).nullish(),
  responsiblePhone: phone.nullish(),
  recipientPhones: z.array(phone).max(10).optional(),
  overdueReminderEveryDays: z.number().int().min(1).max(30).optional(),
  startsOn: isoDate,
  endsOn: isoDate.nullish(),
});

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.enum(EXPENSE_ICONS).optional(),
  color: z.enum(SPACE_COLORS).optional(),
});

export const paymentSchema = z.object({
  amountCents: z.number().int().positive().nullish(),
  paidOn: isoDate.nullish(),
  notes: z.string().max(500).nullish(),
});

export const reminderSchema = z.object({
  type: z.enum(['general', 'call', 'message']).optional(),
  title: z.string().max(120).nullish(),
  message: z.string().max(1000).nullish(),
  dueAt: isoDateTime,
  recurrenceRule: z.string().nullish(),
  recipientPhones: z.array(phone).min(1).max(10),
  contactId: z.string().nullish(),
  personName: z.string().max(120).nullish(),
  personPhone: phone.nullish(),
});

export function webActor(user: AuthUser): Actor {
  return { channel: 'web', userId: user.userId };
}

// ───────────── Projetos ─────────────

export const projectPatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  objective: z.string().max(2000).nullish(),
  estimatedBudgetCents: z.number().int().nonnegative().nullish(),
  groupCheckIns: z.boolean().optional(),
});

export const taskSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeName: z.string().max(120).nullish(),
  dueDate: isoDate.nullish(),
});

export const taskPatchSchema = taskSchema.partial().extend({
  status: z.enum(['proposed', 'open', 'done', 'cancelled']).optional(),
});

export const expenseReviewSchema = z.object({ action: z.enum(['confirm', 'reject', 'mark_paid']) });
export const eventReviewSchema = z.object({ decision: z.enum(['confirm', 'reject']) });

export const contactsQuery = z.object({
  q: z.string().max(80).optional(),
  groupId: z.string().optional(),
  kind: z.enum(['contact', 'resident']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const contactPatchSchema = z.object({
  name: z.string().max(120).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const incomeSchema = z.object({
  source: z.enum(['project', 'room_rental', 'other']),
  description: z.string().trim().min(1).max(160),
  amountCents: z.number().int().positive(),
  expectedOn: isoDate,
  payerName: z.string().max(120).nullish(),
  notes: z.string().max(1000).nullish(),
  projectId: z.string().nullish(),
  spaceId: z.string().nullish(),
});

export const receiveIncomeSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  receivedOn: isoDate.optional(),
});
