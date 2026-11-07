import type { InboundMessage } from '@coxia/contracts';
import type {
  ConnectionStatus,
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
}
