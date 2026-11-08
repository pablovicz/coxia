import type { InboundMessage } from '@coxia/contracts';
import type {
  ConnectCode,
  ConnectionStatus,
  ContactProfile,
  GroupInfo,
  MediaDownload,
  SendMediaInput,
  SendResult,
  SendTextInput,
  WhatsappProvider,
} from './provider';
import { normalizeZapiWebhook } from './zapi-normalizer';

/**
 * Provedor em memória para desenvolvimento local e testes.
 * Aceita payloads no formato Z-API (para reaproveitar as fixtures) e registra os envios.
 */
export class FakeWhatsappProvider implements WhatsappProvider {
  readonly name: InboundMessage['provider'] = 'fake';
  readonly sent: Array<SendTextInput | SendMediaInput> = [];
  groups = new Map<string, GroupInfo>();
  media = new Map<string, MediaDownload>();
  connected = true;
  private seq = 0;

  receiveWebhook(payload: unknown): InboundMessage | null {
    const msg = normalizeZapiWebhook(payload);
    return msg ? { ...msg, provider: 'fake', dedupeKey: msg.dedupeKey.replace(/^zapi:/, 'fake:') } : null;
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    this.sent.push(input);
    return { providerMessageId: `fake-${++this.seq}`, raw: input };
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    this.sent.push(input);
    return { providerMessageId: `fake-${++this.seq}`, raw: input };
  }

  async getMedia(url: string): Promise<MediaDownload> {
    return this.media.get(url) ?? { body: new TextEncoder().encode('fake-media'), contentType: 'application/octet-stream' };
  }

  async getGroupInfo(groupId: string): Promise<GroupInfo> {
    return this.groups.get(groupId) ?? { id: groupId, name: null, participants: [], raw: {} };
  }

  async checkConnection(): Promise<ConnectionStatus> {
    return { connected: this.connected, smartphoneConnected: this.connected, error: null, raw: {} };
  }

  /** QR de mentira (desenvolvimento): um quadriculado SVG. Conectado → não há o que ler. */
  async getQrCode(): Promise<ConnectCode> {
    if (this.connected) return { kind: 'connected' };
    const cells = Array.from({ length: 21 * 21 }, (_, i) => ((i * 7919) % 11 < 5 ? `<rect x="${i % 21}" y="${Math.floor(i / 21)}" width="1" height="1"/>` : '')).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 25 25" shape-rendering="crispEdges"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/>${cells}</svg>`;
    return { kind: 'qr', image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
  }

  profiles = new Map<string, ContactProfile>();

  async getContactProfile(phone: string): Promise<ContactProfile | null> {
    return this.profiles.get(phone) ?? null;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getPhoneCode(): Promise<ConnectCode> {
    return this.connected ? { kind: 'connected' } : { kind: 'code', code: 'FAKE1234' };
  }
}
