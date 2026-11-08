import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { type InboundMessage, type InboundMessageJob, QUEUES } from '@coxia/contracts';
import { enqueueDelivery } from '@coxia/database';
import { CommandService, ProjectWorkspaceService, trackAi } from '@coxia/domain';
import { AiServiceError, normalizePhone, sha256, type WhatsappProvider } from '@coxia/shared';
import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { AI_CLIENT, PrismaService, WHATSAPP_PROVIDER, type WorkerAi } from '../infra.module';
import { StorageService } from '../storage/storage.service';
import { GroupContactsService } from './group-contacts.service';
import { type MessageRoute, routeMessage } from './message-router';

/**
 * Processa uma mensagem persistida pela api.
 * 1. Copia mídia para o bucket (as URLs do provedor expiram).
 * 2. Classifica a rota.
 * 3. Conversa direta com admin → comando (agenda, contas, resumo), com resposta pelo outbox.
 * 4. Grupo de projeto → workspace (ativação, briefing, eventos, encerramento).
 */
@Processor(QUEUES.inbound, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) })
export class InboundProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsappProvider,
    @Inject(AI_CLIENT) private readonly ai: WorkerAi,
    private readonly commands: CommandService,
    private readonly workspace: ProjectWorkspaceService,
    private readonly groupContacts: GroupContactsService,
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
      const stored: StoredAttachment[] = [];
      for (const att of message.attachments.filter((a) => !a.storageKey)) {
        const media = await this.whatsapp.getMedia(att.sourceUrl);
        const key = `org/${message.organizationId}/messages/${message.id}/${att.id}`;
        await this.storage.put(key, media.body, media.contentType ?? att.mimeType);
        const hash = createHash('sha256').update(media.body).digest('hex');
        const mimeType = att.mimeType ?? media.contentType;
        await this.prisma.messageAttachment.update({
          where: { id: att.id },
          data: { storageKey: key, sizeBytes: media.body.byteLength, sha256: hash, mimeType },
        });
        stored.push({ id: att.id, kind: att.kind, mimeType, sha256: hash, storageKey: key });
      }
      for (const att of message.attachments) {
        if (att.storageKey && att.sha256) {
          stored.push({ id: att.id, kind: att.kind, mimeType: att.mimeType, sha256: att.sha256, storageKey: att.storageKey });
        }
      }

      const members = await this.prisma.organizationMember.findMany({
        where: { organizationId: message.organizationId, user: { phone: { not: null } } },
        select: { role: true, canManageProjects: true, user: { select: { phone: true } } },
      });
      const phones = (filter: (m: (typeof members)[number]) => boolean) =>
        new Set(members.filter(filter).flatMap((m) => (m.user.phone ? [normalizePhone(m.user.phone)!] : [])));

      const normalized = message.normalized as unknown as InboundMessage | null;
      // Contatos: quem escreveu, quem entrou ou saiu do grupo (nunca derruba o processamento).
      await this.groupContacts.fromMessage(message, normalized);
      const project = message.conversation.group?.projectChannel?.project ?? null;
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
        linkedProject: project ? { id: project.id, closed: project.status === 'closed' } : null,
        projectGroupPrefix: message.organization.projectGroupPrefix,
        projectManagerPhones: phones((m) => m.canManageProjects || m.role === 'owner'),
        adminPhones: phones((m) => m.role === 'owner' || m.role === 'admin'),
      });

      if (route.route === 'admin_direct' && message.senderPhone) {
        await this.handleCommand(message, stored, traceId);
      }
      // Grupo de projeto (ou candidato com remetente autorizado): o domínio decide o resto.
      if ((route.route === 'project_group' || (route.route === 'project_group_candidate' && route.authorized)) && message.conversation.group) {
        await this.handleProjectMessage(message, message.conversation.group, project?.id ?? null, stored, traceId);
      }

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
      // Erro não retentável da IA (ex.: resposta fora do contrato): não adianta repetir o job.
      if (err instanceof AiServiceError && !err.retryable) {
        await this.prisma.message.update({ where: { id: messageId }, data: { processingStatus: 'failed', processingError: err.message.slice(0, 2000) } });
        return { route: 'skipped' };
      }
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.message.update({
        where: { id: messageId },
        data: { processingStatus: final ? 'failed' : 'queued', processingError: (err as Error).message.slice(0, 2000) },
      });
      throw err;
    }
  }

  /** Texto da mensagem; áudio sem texto é transcrito (uma vez: a transcrição fica no anexo). */
  private async textOf(message: { id: string; organizationId: string; text: string | null }, attachments: StoredAttachment[], traceId: string | null) {
    const audio = attachments.find((a) => a.kind === 'audio');
    if (message.text || !audio) return { text: message.text ?? '', fromAudio: false };
    const existing = await this.prisma.messageAttachment.findUnique({ where: { id: audio.id }, select: { transcript: true } });
    if (existing?.transcript) return { text: existing.transcript, fromAudio: true };
    const url = await this.storage.signedGetUrl(audio.storageKey);
    const { res: t } = await trackAi(
      this.prisma,
      { organizationId: message.organizationId, operation: 'transcribe', sourceMessageId: message.id, request: { attachment: audio.sha256 }, traceId },
      () =>
        this.ai.transcribe(
          { mediaUrl: url, mimeType: audio.mimeType ?? 'audio/ogg', language: 'pt', sourceMessageId: message.id },
          `transcribe:${message.id}`,
          traceId ?? undefined,
        ),
    );
    await this.prisma.messageAttachment.update({ where: { id: audio.id }, data: { transcript: t.text } });
    return { text: t.text, fromAudio: true };
  }

  /** Mensagem num grupo de projeto: ativação, briefing, eventos, encerramento. Resposta pelo outbox. */
  private async handleProjectMessage(
    message: {
      id: string;
      organizationId: string;
      conversationId: string;
      senderPhone: string | null;
      senderName: string | null;
      sentAt: Date;
      text: string | null;
      conversation: { externalChatId: string };
    },
    group: { id: string; name: string | null },
    projectId: string | null,
    attachments: StoredAttachment[],
    traceId: string | null,
  ) {
    const { text, fromAudio } = await this.textOf(message, attachments, traceId);
    const file = attachments.find((a) => a.kind === 'image' || a.kind === 'document');
    const result = await this.workspace.handle({
      organizationId: message.organizationId,
      conversationId: message.conversationId,
      messageId: message.id,
      whatsappGroupId: group.id,
      groupName: group.name,
      senderPhone: message.senderPhone,
      senderName: message.senderName,
      sentAt: message.sentAt,
      text,
      fromAudio,
      attachment: file ? { id: file.id, kind: file.kind, sha256: file.sha256 } : null,
      projectId,
    });
    if (result.reply) {
      await enqueueDelivery(this.prisma, {
        organizationId: message.organizationId,
        recipient: message.conversation.externalChatId,
        text: result.reply,
        idempotencyKey: `reply:${message.id}`,
      });
    }
    this.logger.log({ message_id: message.id, trace_id: traceId, project_id: result.projectId, actions: result.actions }, 'mensagem de projeto processada');
  }

  /** Comando de admin em conversa direta. Áudio é transcrito antes; a resposta sai pelo outbox. */
  private async handleCommand(
    message: { id: string; organizationId: string; conversationId: string; senderPhone: string | null; text: string | null; conversation: { externalChatId: string } },
    attachments: StoredAttachment[],
    traceId: string | null,
  ) {
    const { text } = await this.textOf(message, attachments, traceId);
    const proof = attachments.find((a) => a.kind === 'image' || a.kind === 'document');
    const result = await this.commands.handle({
      organizationId: message.organizationId,
      conversationId: message.conversationId,
      messageId: message.id,
      senderPhone: message.senderPhone!,
      text,
      attachment: proof ? { id: proof.id, sha256: proof.sha256, storageKey: proof.storageKey } : null,
    });
    if (result.reply) {
      // Chave pela mensagem: reprocessar o job não manda a resposta duas vezes.
      await enqueueDelivery(this.prisma, {
        organizationId: message.organizationId,
        recipient: message.conversation.externalChatId,
        text: result.reply,
        idempotencyKey: `reply:${message.id}`,
      });
    }
    this.logger.log({ message_id: message.id, trace_id: traceId, action: result.action }, 'comando processado');
  }
}

interface StoredAttachment {
  id: string;
  kind: string;
  mimeType: string | null;
  sha256: string;
  storageKey: string;
}
