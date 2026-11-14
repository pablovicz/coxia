import type { InboundMessage, InboundMessageKind } from '@coxia/contracts';
import { stableHash } from '../hash';
import { normalizeBrPhone, normalizePhone } from '../phone';

/**
 * Normalização do webhook "on-message-received" da Z-API.
 * Referência: https://z-api-docs.vercel.app/webhooks/on-message-received
 *
 * ATENÇÃO (Etapa 0): os formatos abaixo seguem a documentação pública. Eventos de grupo
 * (criação, renomeação, participantes) precisam ser confirmados com payloads reais e
 * gravados em tests/fixtures/zapi antes de qualquer regra depender deles.
 */

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Json | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;

/** Tipos de callback da Z-API que não representam mensagens e são ignorados aqui. */
const IGNORED_CALLBACK_TYPES = new Set([
  'MessageStatusCallback',
  'PresenceChatCallback',
  'DeliveryCallback',
  'ConnectedCallback',
  'DisconnectedCallback',
]);

export class ZapiPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZapiPayloadError';
  }
}

export function normalizeZapiWebhook(payload: unknown): InboundMessage | null {
  const p = obj(payload);
  if (!p) throw new ZapiPayloadError('payload não é um objeto JSON');

  const type = str(p.type);
  if (type && IGNORED_CALLBACK_TYPES.has(type)) return null;
  if (type && type !== 'ReceivedCallback') return null;

  const instanceId = str(p.instanceId);
  const chatId = str(p.phone);
  if (!instanceId) throw new ZapiPayloadError('instanceId ausente');
  if (!chatId) throw new ZapiPayloadError('phone (ID do chat) ausente');

  const isGroup = p.isGroup === true || chatId.endsWith('-group');
  const fromMe = p.fromMe === true;
  const providerMessageId = str(p.messageId);
  const notificationType = str(p.notification);
  const notificationParameters = Array.isArray(p.notificationParameters)
    ? p.notificationParameters.filter((x): x is string => typeof x === 'string')
    : [];

  const momment = num(p.momment);
  const sentAt = new Date(momment ?? Date.now()).toISOString();

  // Em grupos, quem enviou é o participante; em chats diretos é o próprio chat,
  // a menos que a mensagem tenha saído do número conectado.
  const senderPhone = fromMe
    ? normalizePhone(str(p.connectedPhone))
    : isGroup
      ? normalizePhone(str(p.participantPhone))
      : normalizePhone(chatId);
  const senderLid = isGroup ? str(p.participantLid) : str(p.chatLid);

  const { kind, text, media } = extractContent(p, notificationType);
  const contacts = kind === 'contact' ? extractContacts(p) : [];

  // Eventos sem messageId (ex.: algumas notificações) recebem uma chave determinística,
  // para que reenvios do mesmo evento continuem sendo deduplicados.
  const dedupeId =
    providerMessageId ??
    `evt-${stableHash({ chatId, notificationType, notificationParameters, momment, kind, text })}`;

  return {
    provider: 'zapi',
    instanceId,
    providerMessageId,
    dedupeKey: `zapi:${instanceId}:${dedupeId}`,
    kind,
    chat: {
      id: chatId,
      isGroup,
      name: isGroup ? str(p.chatName) : null,
    },
    sender: {
      phone: senderPhone,
      lid: senderLid,
      name: str(p.senderName),
    },
    fromMe,
    connectedPhone: normalizePhone(str(p.connectedPhone)),
    sentAt,
    text,
    media,
    ...(kind === 'contact' ? { contacts } : {}),
    notification: notificationType
      ? { type: notificationType, parameters: notificationParameters }
      : null,
    flags: {
      isEdit: p.isEdit === true,
      isStatusReply: p.isStatusReply === true,
      isNewsletter: p.isNewsletter === true,
      isBroadcast: p.broadcast === true,
    },
  };
}

function extractContent(
  p: Json,
  notificationType: string | null,
): { kind: InboundMessageKind; text: string | null; media: InboundMessage['media'] } {
  const text = obj(p.text);
  if (text) return { kind: 'text', text: str(text.message), media: null };

  const audio = obj(p.audio);
  if (audio && str(audio.audioUrl)) {
    return {
      kind: 'audio',
      text: null,
      media: {
        url: str(audio.audioUrl)!,
        mimeType: str(audio.mimeType),
        caption: null,
        fileName: null,
        seconds: num(audio.seconds),
        voiceNote: audio.ptt === true,
      },
    };
  }

  const image = obj(p.image);
  if (image && str(image.imageUrl)) {
    const caption = str(image.caption);
    return {
      kind: 'image',
      text: caption,
      media: {
        url: str(image.imageUrl)!,
        mimeType: str(image.mimeType),
        caption,
        fileName: null,
        seconds: null,
        voiceNote: false,
      },
    };
  }

  const document = obj(p.document);
  if (document && str(document.documentUrl)) {
    const caption = str(document.caption);
    return {
      kind: 'document',
      text: caption,
      media: {
        url: str(document.documentUrl)!,
        mimeType: str(document.mimeType),
        caption,
        fileName: str(document.fileName) ?? str(document.title),
        seconds: null,
        voiceNote: false,
      },
    };
  }

  const video = obj(p.video);
  if (video && str(video.videoUrl)) {
    const caption = str(video.caption);
    return {
      kind: 'video',
      text: caption,
      media: {
        url: str(video.videoUrl)!,
        mimeType: str(video.mimeType),
        caption,
        fileName: null,
        seconds: num(video.seconds),
        voiceNote: false,
      },
    };
  }

  const sticker = obj(p.sticker);
  if (sticker && str(sticker.stickerUrl)) {
    return {
      kind: 'sticker',
      text: null,
      media: {
        url: str(sticker.stickerUrl)!,
        mimeType: str(sticker.mimeType),
        caption: null,
        fileName: null,
        seconds: null,
        voiceNote: false,
      },
    };
  }

  const reaction = obj(p.reaction);
  if (reaction) return { kind: 'reaction', text: str(reaction.value), media: null };
  if (obj(p.location)) return { kind: 'location', text: str(obj(p.location)!.address), media: null };
  if (obj(p.contact) || Array.isArray(p.contacts)) {
    const first = obj(p.contact) ?? obj((p.contacts as unknown[])[0]);
    return { kind: 'contact', text: str(first?.displayName), media: null };
  }
  if (notificationType) return { kind: 'notification', text: null, media: null };

  return { kind: 'unknown', text: null, media: null };
}

/**
 * Cartões de contato. A Z-API manda `contact` com `displayName`, `vCard` e `phones`
 * (só dígitos, com DDI). Sem `phones`, os telefones saem do vCard (waid=… ou o número do TEL).
 * `contacts` (vários cartões numa mensagem) não está documentado: lido do mesmo jeito, por precaução.
 */
function extractContacts(p: Json): Array<{ name: string | null; phones: string[] }> {
  const cards = [obj(p.contact), ...(Array.isArray(p.contacts) ? p.contacts.map(obj) : [])].filter((c): c is Json => c !== null);
  return cards.map((card) => {
    const vcard = str(card.vCard) ?? str(card.vcard) ?? '';
    const listed = Array.isArray(card.phones) ? card.phones.map((x) => normalizePhone(typeof x === 'string' ? x : null)) : [];
    const fromVcard = listed.length ? [] : phonesFromVcard(vcard);
    const phones = [...new Set([...listed, ...fromVcard].filter((x): x is string => !!x && x.length >= 10 && x.length <= 15))];
    const fn = /^FN:(.+)$/im.exec(vcard)?.[1]?.trim() ?? null;
    return { name: str(card.displayName) ?? fn, phones };
  });
}

function phonesFromVcard(vcard: string): Array<string | null> {
  const out: Array<string | null> = [];
  for (const line of vcard.split(/\r?\n/)) {
    if (!/^(item\d+\.)?TEL/i.test(line)) continue;
    const waid = /waid=(\d+)/i.exec(line)?.[1];
    if (waid) {
      out.push(normalizePhone(waid));
      continue;
    }
    const value = line.slice(line.indexOf(':') + 1).trim();
    out.push(value ? normalizeBrPhone(value) : null);
  }
  return out;
}
