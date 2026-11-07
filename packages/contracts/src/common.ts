import { z } from 'zod';

export const isoDateTime = z.string().datetime({ offset: true });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'esperado YYYY-MM-DD');
/** Valores monetários sempre em centavos inteiros, para evitar ponto flutuante. */
export const amountCents = z.number().int().nonnegative();
export const currency = z.literal('BRL');
export const confidence = z.number().min(0).max(1);
