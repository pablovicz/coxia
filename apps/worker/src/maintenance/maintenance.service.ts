import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type InboundMessageJob, QUEUES } from '@coxia/contracts';
import { claimDueDeliveries, markDeliveryFailed, markDeliverySent, Prisma, reclaimStaleDeliveries } from '@coxia/database';
import { audit, BillingService, BookingService, NotificationService, ProjectService, SYSTEM_ACTOR } from '@coxia/domain';
import { type WhatsappProvider, WhatsappProviderError } from '@coxia/shared';
import type { Queue } from 'bullmq';
import { PrismaService, WHATSAPP_PROVIDER } from '../infra.module';
import { StorageService } from '../storage/storage.service';

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  reclaimed: number;
  /** WhatsApp desconectado: nada é enviado e nenhuma tentativa é gasta até reconectar. */
  paused: boolean;
}

/** Mensagem presa em "processing" por mais que isso (worker caiu no meio) volta para a fila. */
const STUCK_PROCESSING_MS = 15 * 60_000;
/** Com o envio pausado, a conexão é reconferida com esta frequência (o job normal é a cada 5 min). */
const PAUSED_RECHECK_MS = 60_000;
const RETENTION_BATCH = 200;

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
    private readonly projects: ProjectService,
    private readonly storage: StorageService,
  ) {}

  private organizations() {
    return this.prisma.organization.findMany({ select: { id: true } });
  }

  /** Briefing, avisos, lembretes e check-ins de todas as organizações. Falha numa não impede as outras. */
  async runNotifications(now = new Date()): Promise<{ planned: number; failed: number }> {
    let planned = 0;
    let failed = 0;
    // Encerramentos de projeto não confirmados a tempo voltam a ativo.
    await this.projects.expireStaleClosings(now).catch((err: Error) => this.logger.error({ err: err.message }, 'falha ao expirar encerramentos'));
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

  /**
   * Envia entregas pendentes do outbox. Seguro com várias réplicas (SKIP LOCKED).
   * Com a sessão do WhatsApp desconectada, pausa: mandar agora só gastaria tentativas e levaria
   * avisos válidos ao dead-letter durante a queda. Ao reconectar, a fila segue de onde parou.
   */
  async dispatchOutbox(batchSize = 20, now = new Date()): Promise<DispatchResult> {
    const reclaimed = await reclaimStaleDeliveries(this.prisma);
    const instance = await this.prisma.whatsappInstance.findFirst({
      where: { provider: this.whatsapp.name },
      orderBy: { lastCheckedAt: { sort: 'desc', nulls: 'last' } },
    });
    if (instance && !instance.connected && instance.lastCheckedAt) {
      const recent = now.getTime() - instance.lastCheckedAt.getTime() < PAUSED_RECHECK_MS;
      const stillDown = recent || !(await this.checkConnection(now)).connected;
      if (stillDown) return { claimed: 0, sent: 0, failed: 0, dead: 0, reclaimed, paused: true };
    }
    const deliveries = await claimDueDeliveries(this.prisma, batchSize);
    const result: DispatchResult = { claimed: deliveries.length, sent: 0, failed: 0, dead: 0, reclaimed, paused: false };

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
   * Mensagens que ficaram `received` (falha ao enfileirar), `queued` sem job no Redis ou presas em
   * `processing` (worker caiu no meio) são reenfileiradas. jobId = messageId evita duplicar jobs
   * existentes; reprocessar é seguro porque tudo o que a mensagem gera é idempotente.
   */
  async reconcileInbound(olderThanMs = 60_000, now = new Date()): Promise<number> {
    const stale = await this.prisma.message.findMany({
      where: {
        direction: 'inbound',
        OR: [
          { processingStatus: { in: ['received', 'queued'] }, receivedAt: { lt: new Date(now.getTime() - olderThanMs) } },
          { processingStatus: 'processing', receivedAt: { lt: new Date(now.getTime() - STUCK_PROCESSING_MS) } },
        ],
      },
      select: { id: true, organizationId: true, traceId: true },
      take: 200,
      orderBy: { receivedAt: 'asc' },
    });
    let requeued = 0;
    for (const m of stale) {
      const existing = await this.inboundQueue.getJob(m.id);
      if (existing && ['active', 'waiting', 'delayed', 'waiting-children', 'prioritized'].includes(await existing.getState())) continue;
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

  /**
   * Atualiza o estado da sessão do WhatsApp. Mudanças (caiu/voltou) viram evento de auditoria e
   * log de erro/aviso: base para alerta nos logs do Railway e para o painel de operação.
   */
  async checkConnection(now = new Date()): Promise<{ connected: boolean; changed: boolean }> {
    let connected = false;
    let error: string | null = null;
    try {
      const status = await this.whatsapp.checkConnection();
      connected = status.connected;
      error = status.error;
    } catch (err) {
      error = (err as Error).message;
    }
    const instances = await this.prisma.whatsappInstance.findMany({ where: { provider: this.whatsapp.name } });
    let changed = false;
    for (const inst of instances) {
      await this.prisma.whatsappInstance.update({
        where: { id: inst.id },
        data: { connected, lastCheckedAt: now, lastError: error, ...(connected ? { lastConnectedAt: now } : {}) },
      });
      // Primeira checagem (lastCheckedAt nulo) não conta como mudança.
      if (inst.lastCheckedAt && inst.connected !== connected) {
        changed = true;
        const action = connected ? 'whatsapp.reconnected' : 'whatsapp.disconnected';
        await audit(this.prisma, inst.organizationId, SYSTEM_ACTOR, action, 'whatsapp_instance', inst.id, { after: { error } });
      }
    }
    if (!connected) this.logger.error({ provider: this.whatsapp.name, error, changed }, 'WhatsApp desconectado: envios pausados');
    else if (changed) this.logger.warn({ provider: this.whatsapp.name }, 'WhatsApp reconectado: envios retomados');
    return { connected, changed };
  }

  /**
   * Retenção (avisada no grupo ao ativar o workspace): mensagens mais antigas que
   * organizations.retention_days perdem texto, payload, transcrição e mídia. Ficam a linha (dedupe,
   * vínculo de eventos/tarefas/auditoria) e os comprovantes usados em pagamentos e despesas, que são
   * documentos financeiros. Roda em lotes; idempotente pela marca redacted_at.
   */
  async applyRetention(now = new Date()): Promise<{ messages: number; files: number }> {
    let messages = 0;
    let files = 0;
    const orgs = await this.prisma.organization.findMany({ select: { id: true, retentionDays: true } });
    for (const org of orgs) {
      const cutoff = new Date(now.getTime() - org.retentionDays * 24 * 60 * 60_000);
      let orgMessages = 0;
      let orgFiles = 0;
      for (;;) {
        const batch = await this.prisma.message.findMany({
          where: { organizationId: org.id, receivedAt: { lt: cutoff }, redactedAt: null },
          select: { id: true, attachments: { select: { id: true, storageKey: true } } },
          take: RETENTION_BATCH,
        });
        if (batch.length === 0) break;
        const attachmentIds = batch.flatMap((m) => m.attachments.map((a) => a.id));
        const [billProofs, projectProofs] = await Promise.all([
          this.prisma.paymentAttachment.findMany({ where: { messageAttachmentId: { in: attachmentIds } }, select: { messageAttachmentId: true } }),
          this.prisma.projectExpense.findMany({ where: { proofAttachmentId: { in: attachmentIds } }, select: { proofAttachmentId: true } }),
        ]);
        const keep = new Set([...billProofs.map((p) => p.messageAttachmentId), ...projectProofs.map((p) => p.proofAttachmentId)]);
        for (const m of batch) {
          for (const a of m.attachments) {
            if (keep.has(a.id)) continue;
            if (a.storageKey) {
              await this.storage.delete(a.storageKey);
              orgFiles++;
            }
            await this.prisma.messageAttachment.update({ where: { id: a.id }, data: { storageKey: null, transcript: null, sourceUrl: '' } });
          }
          await this.prisma.message.update({
            where: { id: m.id },
            data: { text: null, rawPayload: Prisma.DbNull, normalized: Prisma.DbNull, processingError: null, redactedAt: now },
          });
          orgMessages++;
        }
      }
      if (orgMessages) {
        await audit(this.prisma, org.id, SYSTEM_ACTOR, 'retention.applied', 'organization', org.id, {
          after: { messages: orgMessages, files: orgFiles, cutoff: cutoff.toISOString() },
        });
        this.logger.log({ organization_id: org.id, messages: orgMessages, files: orgFiles }, 'retenção aplicada');
      }
      messages += orgMessages;
      files += orgFiles;
    }
    return { messages, files };
  }
}
