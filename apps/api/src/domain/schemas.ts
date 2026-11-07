import { z } from 'zod';
import type { AuthUser } from '../auth/decorators';
import type { Actor } from '@coxia/domain';

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

export const createBookingSchema = z.object({
  spaceId: z.string().min(1),
  startAt: isoDateTime,
  endAt: isoDateTime,
  title: z.string().max(120).nullish(),
  responsibleName: z.string().max(120).nullish(),
  responsiblePhone: phone.nullish(),
  notes: z.string().max(1000).nullish(),
  status: z.enum(['confirmed', 'tentative']).optional(),
  recurrence: z.object({ rule: z.string().min(5), until: isoDate.nullish() }).nullish(),
  notifyOneHourBefore: z.boolean().optional(),
  onConflict: z.enum(['fail', 'skip']).optional(),
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

export const cancelSeriesSchema = z.object({ fromDate: isoDate });

export const spaceSchema = z.object({
  name: z.string().min(1).max(80),
  aliases: z.array(z.string().max(40)).max(10).optional(),
  capacity: z.number().int().positive().nullish(),
  sortOrder: z.number().int().optional(),
});

export const availabilitySchema = z.object({
  rules: z.array(z.object({ weekday: z.number().int().min(1).max(7), opensAt: hhmm, closesAt: hhmm })).max(21),
});

export const blockSchema = z.object({ startAt: isoDateTime, endAt: isoDateTime, reason: z.string().max(200).nullish() });

export const billSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(['aluguel', 'energia', 'agua', 'internet', 'telefone', 'outros']),
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

export const paymentSchema = z.object({
  amountCents: z.number().int().positive().nullish(),
  paidOn: isoDate.nullish(),
  notes: z.string().max(500).nullish(),
});

export const reminderSchema = z.object({
  title: z.string().min(1).max(120),
  message: z.string().max(1000).nullish(),
  dueAt: isoDateTime,
  recurrenceRule: z.string().nullish(),
  recipientPhones: z.array(phone).min(1).max(10),
});

export function webActor(user: AuthUser): Actor {
  return { channel: 'web', userId: user.userId };
}
