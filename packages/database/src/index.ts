import { Prisma, PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export * from './outbox';

/** Nome da constraint EXCLUDE que impede reservas sobrepostas (ver migration 0001). */
export const BOOKING_OVERLAP_CONSTRAINT = 'booking_occurrences_no_overlap';

/**
 * Identifica a violação da constraint de sobreposição de reservas.
 * O Postgres devolve SQLSTATE 23P01 (exclusion_violation); o Prisma repassa como erro "unknown"
 * ou como P2010/P2034 dependendo da operação, então verificamos o código e a mensagem.
 */
export function isBookingOverlapError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = JSON.stringify(err.meta ?? {});
    return meta.includes('23P01') || meta.includes(BOOKING_OVERLAP_CONSTRAINT) || err.message.includes(BOOKING_OVERLAP_CONSTRAINT);
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return err.message.includes('23P01') || err.message.includes(BOOKING_OVERLAP_CONSTRAINT);
  }
  return false;
}

/** Violação de unique (P2002) — usada para tornar inserts idempotentes. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}
