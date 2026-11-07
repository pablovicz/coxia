import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, HttpCode, Module, NotFoundException, Param, Post, UnprocessableEntityException } from '@nestjs/common';
import { type InboundMessageJob, MAINTENANCE_JOBS, QUEUES } from '@coxia/contracts';
import { audit } from '@coxia/domain';
import type { Queue } from 'bullmq';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { webActor } from '../domain/schemas';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Operação (Etapa 4): saúde da integração e reprocessamento manual.
 * Tudo o que aqui aparece também sai em log estruturado; o painel só dá visibilidade e ação.
 */
@Roles('owner', 'admin')
@Controller('ops')
export class OpsController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.inbound) private readonly inbound: Queue<InboundMessageJob>,
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const org = user.organizationId;
    const now = Date.now();
    const since = new Date(now - DAY_MS);
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { retentionDays: true } });
    const [instances, msgStatus, oldestPending, deliveryStatus, oldestDelivery, sent24h, ai, inboundCounts, maintenanceCounts, retention, lastInbound] =
      await Promise.all([
        this.prisma.whatsappInstance.findMany({
          where: { organizationId: org },
          select: { provider: true, connected: true, lastCheckedAt: true, lastConnectedAt: true, lastError: true },
        }),
        this.prisma.message.groupBy({ by: ['processingStatus'], where: { organizationId: org, receivedAt: { gte: since } }, _count: true }),
        this.prisma.message.findFirst({
          where: { organizationId: org, processingStatus: { in: ['received', 'queued', 'processing'] } },
          orderBy: { receivedAt: 'asc' },
          select: { receivedAt: true },
        }),
        this.prisma.notificationDelivery.groupBy({ by: ['status'], where: { organizationId: org }, _count: true }),
        this.prisma.notificationDelivery.findFirst({
          where: { organizationId: org, status: { in: ['pending', 'failed', 'sending'] } },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.notificationDelivery.count({ where: { organizationId: org, status: 'sent', sentAt: { gte: since } } }),
        this.prisma.aiExecution.groupBy({
          by: ['operation', 'status'],
          where: { organizationId: org, createdAt: { gte: since } },
          _count: true,
          _sum: { inputTokens: true, outputTokens: true },
          _avg: { latencyMs: true },
        }),
        this.inbound.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null),
        this.maintenance.getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null),
        this.prisma.auditEvent.findFirst({ where: { organizationId: org, action: 'retention.applied' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, after: true } }),
        this.prisma.message.findFirst({ where: { organizationId: org, direction: 'inbound' }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
      ]);

    const byOp = new Map<string, { operation: string; calls: number; failures: number; inputTokens: number; outputTokens: number; avgLatencyMs: number }>();
    for (const row of ai) {
      const cur = byOp.get(row.operation) ?? { operation: row.operation, calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: 0 };
      cur.calls += row._count;
      if (row.status === 'failed') cur.failures += row._count;
      cur.inputTokens += row._sum.inputTokens ?? 0;
      cur.outputTokens += row._sum.outputTokens ?? 0;
      if (row.status === 'succeeded') cur.avgLatencyMs = Math.round(row._avg.latencyMs ?? 0);
      byOp.set(row.operation, cur);
    }
    const count = <T extends string>(rows: Array<{ _count: number } & Record<string, unknown>>, key: string, values: readonly T[]) =>
      Object.fromEntries(values.map((v) => [v, rows.find((r) => r[key] === v)?._count ?? 0])) as Record<T, number>;

    return {
      generatedAt: new Date(now).toISOString(),
      whatsapp: instances,
      lastInboundAt: lastInbound?.receivedAt ?? null,
      inbound: {
        last24h: count(msgStatus, 'processingStatus', ['received', 'queued', 'processing', 'processed', 'ignored', 'failed'] as const),
        /** Atraso da mensagem mais antiga ainda não processada (segundos). */
        oldestPendingSeconds: oldestPending ? Math.round((now - oldestPending.receivedAt.getTime()) / 1000) : 0,
        queue: inboundCounts,
      },
      outbox: {
        byStatus: count(deliveryStatus, 'status', ['pending', 'sending', 'failed', 'sent', 'dead'] as const),
        sentLast24h: sent24h,
        oldestPendingSeconds: oldestDelivery ? Math.round((now - oldestDelivery.createdAt.getTime()) / 1000) : 0,
      },
      maintenanceQueue: maintenanceCounts,
      ai: [...byOp.values()].sort((a, b) => a.operation.localeCompare(b.operation)),
      retention: { days: organization.retentionDays, lastRunAt: retention?.createdAt ?? null, result: retention?.after ?? null },
    };
  }

  @Get('messages/failed')
  failedMessages(@CurrentUser() user: AuthUser) {
    return this.prisma.message.findMany({
      where: { organizationId: user.organizationId, processingStatus: 'failed' },
      orderBy: { receivedAt: 'desc' },
      take: 50,
      select: { id: true, kind: true, senderName: true, senderPhone: true, receivedAt: true, processingError: true, conversation: { select: { isGroup: true, group: { select: { name: true } } } } },
    });
  }

  /** Reprocessa uma mensagem que falhou (ex.: IA fora do ar). Seguro: tudo o que ela gera é idempotente. */
  @Post('messages/:id/retry')
  @HttpCode(202)
  async retryMessage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const msg = await this.prisma.message.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');
    if (msg.processingStatus !== 'failed') throw new UnprocessableEntityException('Só mensagens com falha podem ser reprocessadas');
    if (msg.redactedAt) throw new UnprocessableEntityException('O conteúdo desta mensagem já foi apagado pela retenção');
    const old = await this.inbound.getJob(id);
    if (old) await old.remove();
    await this.prisma.message.update({ where: { id }, data: { processingStatus: 'queued', processingError: null } });
    await this.inbound.add('process', { messageId: id, organizationId: msg.organizationId, traceId: msg.traceId }, { jobId: id, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } });
    await audit(this.prisma, user.organizationId, webActor(user), 'ops.message_retry', 'message', id);
    return { status: 'queued' };
  }

  @Get('deliveries/dead')
  deadDeliveries(@CurrentUser() user: AuthUser) {
    return this.prisma.notificationDelivery.findMany({
      where: { organizationId: user.organizationId, status: 'dead' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, recipient: true, text: true, attempts: true, lastError: true, updatedAt: true },
    });
  }

  /** Devolve uma entrega do dead-letter à fila (ex.: número corrigido, WhatsApp reconectado). */
  @Post('deliveries/:id/retry')
  @HttpCode(202)
  async retryDelivery(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { count } = await this.prisma.notificationDelivery.updateMany({
      where: { id, organizationId: user.organizationId, status: 'dead' },
      data: { status: 'pending', attempts: 0, availableAt: new Date(), lastError: null },
    });
    if (!count) throw new NotFoundException('Entrega não encontrada no dead-letter');
    await audit(this.prisma, user.organizationId, webActor(user), 'ops.delivery_retry', 'notification_delivery', id);
    return { status: 'pending' };
  }

  /** Pede uma checagem imediata da conexão (o worker roda a cada 5 min). */
  @Post('whatsapp/check')
  @HttpCode(202)
  async checkNow() {
    await this.maintenance.add(MAINTENANCE_JOBS.checkConnection, {}, { removeOnComplete: 100, removeOnFail: 500 });
    return { status: 'scheduled' };
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.inbound }, { name: QUEUES.maintenance })],
  controllers: [OpsController],
})
export class OpsModule {}
