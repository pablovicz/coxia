import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@coxia/database';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  organizationId: string;
  actorChannel: 'whatsapp' | 'web' | 'system' | 'ai';
  actorUserId?: string | null;
  actorPhone?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  sourceMessageId?: string | null;
  traceId?: string | null;
}

/** Trilha de auditoria: toda decisão relevante liga quem, quando, de onde e qual mensagem originou. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: AuditInput, tx: Prisma.TransactionClient = this.prisma) {
    return tx.auditEvent.create({
      data: {
        ...input,
        before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
