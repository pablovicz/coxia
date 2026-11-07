import { Prisma, type NotificationDelivery, type PrismaClient } from '@prisma/client';

/**
 * Outbox de notificações.
 * - `enqueueDelivery` deve ser chamado dentro da mesma transação da mudança de domínio.
 * - O worker reivindica entregas com FOR UPDATE SKIP LOCKED, então várias réplicas
 *   podem rodar sem enviar a mesma mensagem duas vezes.
 * - Falhas usam backoff exponencial; ao esgotar as tentativas a entrega vai para `dead`
 *   (dead-letter), visível no painel e nas métricas.
 */

type Tx = Prisma.TransactionClient | PrismaClient;

export interface EnqueueDeliveryInput {
  organizationId: string;
  recipient: string;
  text: string;
  /** Mesma chave = mesma notificação. Ex.: `bill_day_before:<occurrenceId>:<phone>`. */
  idempotencyKey: string;
  scheduleId?: string | null;
  availableAt?: Date;
  maxAttempts?: number;
}

export async function enqueueDelivery(tx: Tx, input: EnqueueDeliveryInput): Promise<NotificationDelivery> {
  return tx.notificationDelivery.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      organizationId: input.organizationId,
      recipient: input.recipient,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
      scheduleId: input.scheduleId ?? null,
      availableAt: input.availableAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    },
  });
}

/** Reivindica até `limit` entregas pendentes e vencidas, marcando-as como `sending`. */
export async function claimDueDeliveries(
  prisma: PrismaClient,
  limit: number,
  now: Date = new Date(),
): Promise<NotificationDelivery[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "notification_deliveries" AS d
       SET "status" = 'sending', "attempts" = d."attempts" + 1, "updated_at" = ${now}
     WHERE d."id" IN (
       SELECT "id" FROM "notification_deliveries"
        WHERE "status" IN ('pending', 'failed') AND "available_at" <= ${now}
        ORDER BY "available_at"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING d."id"`;
  if (rows.length === 0) return [];
  return prisma.notificationDelivery.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    orderBy: { availableAt: 'asc' },
  });
}

export async function markDeliverySent(
  prisma: PrismaClient,
  id: string,
  providerMessageId: string | null,
  now: Date = new Date(),
): Promise<void> {
  await prisma.notificationDelivery.update({
    where: { id },
    data: { status: 'sent', sentAt: now, providerMessageId, lastError: null },
  });
}

/** Backoff: 30s, 2min, 8min, 32min… limitado a 2h. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 2 * 60 * 60 * 1000);
}

export async function markDeliveryFailed(
  prisma: PrismaClient,
  delivery: Pick<NotificationDelivery, 'id' | 'attempts' | 'maxAttempts'>,
  error: string,
  retryable: boolean,
  now: Date = new Date(),
): Promise<'failed' | 'dead'> {
  const dead = !retryable || delivery.attempts >= delivery.maxAttempts;
  await prisma.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: dead ? 'dead' : 'failed',
      lastError: error.slice(0, 2000),
      availableAt: dead ? undefined : new Date(now.getTime() + retryDelayMs(delivery.attempts)),
    },
  });
  return dead ? 'dead' : 'failed';
}

/**
 * Entregas presas em `sending` (worker caiu no meio do envio) voltam para `failed`.
 * Risco consciente: se o envio chegou a acontecer, a mensagem pode ser reenviada uma vez.
 */
export async function reclaimStaleDeliveries(
  prisma: PrismaClient,
  olderThanMs = 5 * 60 * 1000,
  now: Date = new Date(),
): Promise<number> {
  const result = await prisma.notificationDelivery.updateMany({
    where: { status: 'sending', updatedAt: { lt: new Date(now.getTime() - olderThanMs) } },
    data: { status: 'failed', lastError: 'reclaimed: envio interrompido', availableAt: now },
  });
  return result.count;
}
