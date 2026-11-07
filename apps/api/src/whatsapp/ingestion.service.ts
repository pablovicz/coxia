import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type InboundMessage, type InboundMessageJob, QUEUES } from '@coxia/contracts';
import { isUniqueViolation, type Prisma } from '@coxia/database';
import { type WhatsappProvider, ZapiPayloadError } from '@coxia/shared';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_PROVIDER } from './whatsapp.provider';

export type IngestResult =
  | { status: 'accepted'; messageId: string }
  | { status: 'duplicate'; messageId: string }
  | { status: 'ignored'; reason: 'not_a_message' | 'invalid_payload' | 'unknown_instance' };

/**
 * Entrada do webhook: normaliza → deduplica → persiste → enfileira → responde rápido.
 * Nenhuma IA ou regra de negócio roda aqui; isso é trabalho do worker.
 * Se o enfileiramento falhar, a mensagem fica `received` e a reconciliação do worker a reenfileira.
 */
@Injectable()
export class WhatsappIngestionService {
  private readonly logger = new Logger(WhatsappIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsappProvider,
    @InjectQueue(QUEUES.inbound) private readonly inboundQueue: Queue<InboundMessageJob>,
  ) {}

  async ingest(payload: unknown, traceId: string | null): Promise<IngestResult> {
    let msg: InboundMessage | null;
    try {
      msg = this.provider.receiveWebhook(payload);
    } catch (err) {
      if (err instanceof ZapiPayloadError) {
        // Payload malformado não melhora com reenvio: responder 200 e registrar.
        this.logger.warn({ err: err.message, traceId }, 'webhook com payload inválido');
        return { status: 'ignored', reason: 'invalid_payload' };
      }
      throw err;
    }
    if (!msg) return { status: 'ignored', reason: 'not_a_message' };

    const instance = await this.prisma.whatsappInstance.findUnique({
      where: { provider_externalInstanceId: { provider: msg.provider, externalInstanceId: msg.instanceId } },
    });
    if (!instance) {
      this.logger.warn({ instanceId: msg.instanceId, traceId }, 'webhook de instância não cadastrada');
      return { status: 'ignored', reason: 'unknown_instance' };
    }

    const existing = await this.prisma.message.findUnique({ where: { dedupeKey: msg.dedupeKey }, select: { id: true } });
    if (existing) return { status: 'duplicate', messageId: existing.id };

    let messageId: string;
    try {
      messageId = await this.persist(instance.id, instance.organizationId, msg, payload, traceId);
    } catch (err) {
      // Corrida entre dois reenvios simultâneos: o segundo perde no unique de dedupe_key.
      if (isUniqueViolation(err)) {
        const winner = await this.prisma.message.findUniqueOrThrow({ where: { dedupeKey: msg.dedupeKey }, select: { id: true } });
        return { status: 'duplicate', messageId: winner.id };
      }
      throw err;
    }

    await this.enqueue(messageId, instance.organizationId, traceId);
    return { status: 'accepted', messageId };
  }

  private async persist(
    instanceId: string,
    organizationId: string,
    msg: InboundMessage,
    payload: unknown,
    traceId: string | null,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      let groupId: string | null = null;
      if (msg.chat.isGroup) {
        // Identidade pelo ID do grupo; o nome só é atualizado (renomeação preserva o vínculo).
        const group = await tx.whatsappGroup.upsert({
          where: { instanceId_externalGroupId: { instanceId, externalGroupId: msg.chat.id } },
          update: { lastSeenAt: new Date(), ...(msg.chat.name ? { name: msg.chat.name } : {}) },
          create: { organizationId, instanceId, externalGroupId: msg.chat.id, name: msg.chat.name },
        });
        groupId = group.id;
      }

      const conversation = await tx.conversation.upsert({
        where: { instanceId_externalChatId: { instanceId, externalChatId: msg.chat.id } },
        update: { lastMessageAt: new Date(msg.sentAt) },
        create: {
          organizationId,
          instanceId,
          externalChatId: msg.chat.id,
          isGroup: msg.chat.isGroup,
          groupId,
          lastMessageAt: new Date(msg.sentAt),
        },
      });

      const message = await tx.message.create({
        data: {
          organizationId,
          conversationId: conversation.id,
          direction: 'inbound',
          provider: msg.provider,
          externalMessageId: msg.providerMessageId,
          dedupeKey: msg.dedupeKey,
          kind: msg.kind,
          senderPhone: msg.sender.phone,
          senderName: msg.sender.name,
          fromMe: msg.fromMe,
          text: msg.text,
          sentAt: new Date(msg.sentAt),
          rawPayload: payload as Prisma.InputJsonValue,
          normalized: msg as unknown as Prisma.InputJsonValue,
          traceId,
        },
        select: { id: true },
      });

      if (msg.media) {
        await tx.messageAttachment.create({
          data: {
            organizationId,
            messageId: message.id,
            kind: msg.kind,
            mimeType: msg.media.mimeType,
            fileName: msg.media.fileName,
            sourceUrl: msg.media.url,
            durationSeconds: msg.media.seconds,
          },
        });
      }
      return message.id;
    });
  }

  private async enqueue(messageId: string, organizationId: string, traceId: string | null): Promise<void> {
    try {
      await this.inboundQueue.add(
        'process',
        { messageId, organizationId, traceId },
        {
          jobId: messageId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 24 * 3600, count: 5_000 },
          removeOnFail: { age: 14 * 24 * 3600 },
        },
      );
      await this.prisma.message.update({ where: { id: messageId }, data: { processingStatus: 'queued' } });
    } catch (err) {
      this.logger.error({ err: (err as Error).message, messageId, traceId }, 'falha ao enfileirar; reconciliação vai reprocessar');
    }
  }
}
