import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { type InboundMessage, type InboundMessageJob, QUEUES } from '@coxia/contracts';
import { normalizePhone, sha256, type WhatsappProvider } from '@coxia/shared';
import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { PrismaService, WHATSAPP_PROVIDER } from '../infra.module';
import { StorageService } from '../storage/storage.service';
import { type MessageRoute, routeMessage } from './message-router';

/**
 * Processa uma mensagem persistida pela api.
 * Etapa 1: copia mídia para o bucket (as URLs do provedor expiram) e classifica a rota.
 * As ações por rota (workspace de projeto, comandos de agenda/contas) entram nas Etapas 2 e 3.
 */
@Processor(QUEUES.inbound, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) })
export class InboundProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsappProvider,
  ) {
    super();
  }

  async process(job: Job<InboundMessageJob>): Promise<MessageRoute | { route: 'skipped' }> {
    const { messageId, traceId } = job.data;
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        attachments: true,
        organization: true,
        conversation: { include: { group: { include: { projectChannel: { include: { project: true } } } } } },
      },
    });
    if (!message) return { route: 'skipped' };
    if (message.processingStatus === 'processed' || message.processingStatus === 'ignored') return { route: 'skipped' };

    await this.prisma.message.update({ where: { id: messageId }, data: { processingStatus: 'processing' } });
    try {
      for (const att of message.attachments.filter((a) => !a.storageKey)) {
        const media = await this.whatsapp.getMedia(att.sourceUrl);
        const key = `org/${message.organizationId}/messages/${message.id}/${att.id}`;
        await this.storage.put(key, media.body, media.contentType ?? att.mimeType);
        await this.prisma.messageAttachment.update({
          where: { id: att.id },
          data: {
            storageKey: key,
            sizeBytes: media.body.byteLength,
            sha256: createHash('sha256').update(media.body).digest('hex'),
            mimeType: att.mimeType ?? media.contentType,
          },
        });
      }

      const members = await this.prisma.organizationMember.findMany({
        where: { organizationId: message.organizationId, user: { phone: { not: null } } },
        select: { role: true, canManageProjects: true, user: { select: { phone: true } } },
      });
      const phones = (filter: (m: (typeof members)[number]) => boolean) =>
        new Set(members.filter(filter).flatMap((m) => (m.user.phone ? [normalizePhone(m.user.phone)!] : [])));

      const normalized = message.normalized as unknown as InboundMessage | null;
      const project = message.conversation.group?.projectChannel?.project;
      const route = routeMessage({
        kind: message.kind,
        fromMe: message.fromMe,
        isGroup: message.conversation.isGroup,
        groupName: message.conversation.group?.name ?? null,
        senderPhone: message.senderPhone,
        flags: {
          isStatusReply: normalized?.flags.isStatusReply ?? false,
          isNewsletter: normalized?.flags.isNewsletter ?? false,
          isBroadcast: normalized?.flags.isBroadcast ?? false,
        },
        linkedProjectId: project && project.status !== 'closed' ? project.id : null,
        projectGroupPrefix: message.organization.projectGroupPrefix,
        projectManagerPhones: phones((m) => m.canManageProjects || m.role === 'owner'),
        adminPhones: phones((m) => m.role === 'owner' || m.role === 'admin'),
      });

      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          processingStatus: route.route === 'ignored' ? 'ignored' : 'processed',
          processedAt: new Date(),
          processingError: null,
        },
      });
      this.logger.log({ message_id: messageId, trace_id: traceId, route: route.route, hash: sha256(messageId).slice(0, 8) }, 'mensagem processada');
      return route;
    } catch (err) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.message.update({
        where: { id: messageId },
        data: { processingStatus: final ? 'failed' : 'queued', processingError: (err as Error).message.slice(0, 2000) },
      });
      throw err;
    }
  }
}
