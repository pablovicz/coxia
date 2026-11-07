import type { Prisma, PrismaClient } from '@coxia/database';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient | PrismaClient;

export type DomainErrorCode = 'not_found' | 'validation' | 'conflict' | 'forbidden';

/** Erro de regra de negócio. A api traduz o código em status HTTP; o worker, em resposta no WhatsApp. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Quem fez a ação — vai para a trilha de auditoria. */
export interface Actor {
  channel: 'whatsapp' | 'web' | 'system';
  userId?: string | null;
  phone?: string | null;
  sourceMessageId?: string | null;
  traceId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { channel: 'system' };

export async function audit(
  tx: Tx,
  organizationId: string,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  data: { before?: unknown; after?: unknown } = {},
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId,
      actorChannel: actor.channel,
      actorUserId: actor.userId ?? null,
      actorPhone: actor.phone ?? null,
      sourceMessageId: actor.sourceMessageId ?? null,
      traceId: actor.traceId ?? null,
      action,
      entityType,
      entityId,
      before: data.before === undefined ? undefined : (JSON.parse(JSON.stringify(data.before)) as Prisma.InputJsonValue),
      after: data.after === undefined ? undefined : (JSON.parse(JSON.stringify(data.after)) as Prisma.InputJsonValue),
    },
  });
}

/** Data de calendário (Date @db.Date do Prisma) → YYYY-MM-DD. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → Date para colunas @db.Date. */
export function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export async function getOrganization(db: Tx, organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new DomainError('not_found', 'Organização não encontrada');
  return org;
}
