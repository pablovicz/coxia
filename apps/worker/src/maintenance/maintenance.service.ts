import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type InboundMessageJob, QUEUES } from '@coxia/contracts';
import { claimDueDeliveries, markDeliveryFailed, markDeliverySent, reclaimStaleDeliveries } from '@coxia/database';
import { BillingService, BookingService, NotificationService } from '@coxia/domain';
import { type WhatsappProvider, WhatsappProviderError } from '@coxia/shared';
import type { Queue } from 'bullmq';
import { PrismaService, WHATSAPP_PROVIDER } from '../infra.module';

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  reclaimed: number;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsappProvider,
    @InjectQueue(QUEUES.inbound) private readonly inboundQueue: Queue<InboundMessageJob>,
    private readonly notifications: NotificationService,
    private readonly billing: BillingService,
    private readonly bookings: BookingService,
  ) {}

  private organizations() {
    return this.prisma.organization.findMany({ select: { id: true } });
  }

  /** Briefing, avisos e lembretes de todas as organizações. Falha numa não impede as outras. */
  async runNotifications(now = new Date()): Promise<{ planned: number; failed: number }> {
    let planned = 0;
    let failed = 0;
    for (const org of await this.organizations()) {
      try {
        planned += (await this.notifications.run(org.id, now)).length;
      } catch (err) {
        failed++;
        this.logger.error({ organization_id: org.id, err: (err as Error).message }, 'falha ao planejar notificações');
      }
    }
    return { planned, failed };
  }

  async generateBillOccurrences(now = new Date()): Promise<{ created: number }> {
    let created = 0;
    for (const org of await this.organizations()) created += await this.billing.generateOccurrences(org.id, now);
    return { created };
  }

  async extendBookingSeries(now = new Date()) {
    const report = await this.bookings.extendSeries(now);
    const skipped = report.reduce((s, r) => s + r.skipped.length, 0);
    if (skipped) {
      this.logger.warn({ skipped, series: report.filter((r) => r.skipped.length).map((r) => r.bookingId) }, 'ocorrências de série puladas por conflito');
    }
    return { series: report.length, created: report.reduce((s, r) => s + r.created, 0), skipped };
  }

  /** Envia entregas pendentes do outbox. Seguro com várias réplicas (SKIP LOCKED). */
  async dispatchOutbox(batchSize = 20): Promise<DispatchResult> {
    const reclaimed = await reclaimStaleDeliveries(this.prisma);
    const deliveries = await claimDueDeliveries(this.prisma, batchSize);
    const result: DispatchResult = { claimed: deliveries.length, sent: 0, failed: 0, dead: 0, reclaimed };

    for (const d of deliveries) {
      try {
        const sent = await this.whatsapp.sendText({ to: d.recipient, text: d.text });
        await markDeliverySent(this.prisma, d.id, sent.providerMessageId);
        result.sent++;
      } catch (err) {
        const retryable = err instanceof WhatsappProviderError ? err.retryable : true;
        const outcome = await markDeliveryFailed(this.prisma, d, (err as Error).message, retryable);
        result[outcome]++;
        if (outcome === 'dead') {
          this.logger.error({ delivery_id: d.id, err: (err as Error).message }, 'entrega movida para dead-letter');
        }
      }
    }
    return result;
  }

  /**
   * Mensagens que ficaram `received` (falha ao enfileirar) ou `queued` sem job no Redis
   * são reenfileiradas. jobId = messageId evita duplicar jobs existentes.
   */
  async reconcileInbound(olderThanMs = 60_000): Promise<number> {
    const stale = await this.prisma.message.findMany({
      where: {
        direction: 'inbound',
        processingStatus: { in: ['received', 'queued'] },
        receivedAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      select: { id: true, organizationId: true, traceId: true },
      take: 200,
      orderBy: { receivedAt: 'asc' },
    });
    let requeued = 0;
    for (const m of stale) {
      const existing = await this.inboundQueue.getJob(m.id);
      if (existing && !(await existing.isFailed()) && !(await existing.isCompleted())) continue;
      if (existing) await existing.remove();
      await this.inboundQueue.add(
        'process',
        { messageId: m.id, organizationId: m.organizationId, traceId: m.traceId },
        { jobId: m.id, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
      );
      await this.prisma.message.update({ where: { id: m.id }, data: { processingStatus: 'queued' } });
      requeued++;
    }
    if (requeued > 0) this.logger.warn({ requeued }, 'mensagens reenfileiradas pela reconciliação');
    return requeued;
  }

  /** Atualiza o estado da sessão do WhatsApp; desconexão gera log de erro para alerta. */
  async checkConnection(): Promise<{ connected: boolean }> {
    const now = new Date();
    let connected = false;
    let error: string | null = null;
    try {
      const status = await this.whatsapp.checkConnection();
      connected = status.connected;
      error = status.error;
    } catch (err) {
      error = (err as Error).message;
    }
    await this.prisma.whatsappInstance.updateMany({
      where: { provider: this.whatsapp.name },
      data: { connected, lastCheckedAt: now, lastError: error, ...(connected ? { lastConnectedAt: now } : {}) },
    });
    if (!connected) this.logger.error({ provider: this.whatsapp.name, error }, 'WhatsApp desconectado');
    return { connected };
  }
}
