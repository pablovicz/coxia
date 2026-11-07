import { z } from 'zod';
import { isoDateTime } from './common';

/**
 * Mensagem recebida, normalizada e independente do provedor de WhatsApp.
 * Todo payload de webhook vira um InboundMessage antes de chegar ao domínio.
 */
export const inboundMessageKind = z.enum([
  'text',
  'audio',
  'image',
  'document',
  'video',
  'sticker',
  'reaction',
  'location',
  'contact',
  'notification',
  'unknown',
]);
export type InboundMessageKind = z.infer<typeof inboundMessageKind>;

export const inboundMedia = z.object({
  url: z.string().url(),
  mimeType: z.string().nullable(),
  caption: z.string().nullable(),
  fileName: z.string().nullable(),
  /** Duração (áudio/vídeo), em segundos. */
  seconds: z.number().nonnegative().nullable(),
  /** true para áudio gravado no app (voice note / PTT). */
  voiceNote: z.boolean(),
});
export type InboundMedia = z.infer<typeof inboundMedia>;

export const inboundMessage = z.object({
  provider: z.enum(['zapi', 'fake']),
  instanceId: z.string().min(1),
  /** ID do provedor; null para eventos sem ID, que usam chave determinística. */
  providerMessageId: z.string().nullable(),
  /** Chave de deduplicação: `${provider}:${instanceId}:${messageId | hash do evento}`. */
  dedupeKey: z.string().min(1),
  kind: inboundMessageKind,
  chat: z.object({
    /** ID estável do chat; em grupos, é o ID do grupo (nunca usar o nome como chave). */
    id: z.string().min(1),
    isGroup: z.boolean(),
    name: z.string().nullable(),
  }),
  sender: z.object({
    /** Telefone só com dígitos (E.164 sem '+'), quando disponível. Em grupos, é o participante. */
    phone: z.string().nullable(),
    lid: z.string().nullable(),
    name: z.string().nullable(),
  }),
  fromMe: z.boolean(),
  sentAt: isoDateTime,
  text: z.string().nullable(),
  media: inboundMedia.nullable(),
  notification: z
    .object({
      type: z.string(),
      parameters: z.array(z.string()),
    })
    .nullable(),
  flags: z.object({
    isEdit: z.boolean(),
    isStatusReply: z.boolean(),
    isNewsletter: z.boolean(),
    isBroadcast: z.boolean(),
  }),
});
export type InboundMessage = z.infer<typeof inboundMessage>;
