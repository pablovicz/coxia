import type { InboundMessage } from '@coxia/contracts';

/**
 * Fronteira com o provedor de WhatsApp. O domínio só conhece esta interface;
 * trocar Z-API por Meta Cloud API (ou outro) significa escrever um novo adaptador.
 */
export interface WhatsappProvider {
  readonly name: InboundMessage['provider'];

  /**
   * Normaliza um payload de webhook. Retorna null quando o evento deve ser ignorado
   * (ex.: callbacks de status de entrega, que não são mensagens).
   */
  receiveWebhook(payload: unknown): InboundMessage | null;

  sendText(input: SendTextInput): Promise<SendResult>;
  sendMedia(input: SendMediaInput): Promise<SendResult>;
  getMedia(url: string): Promise<MediaDownload>;
  getGroupInfo(groupId: string): Promise<GroupInfo>;
  checkConnection(): Promise<ConnectionStatus>;
}

export interface SendTextInput {
  /** Telefone (só dígitos) ou ID do grupo. */
  to: string;
  text: string;
}

export interface SendMediaInput {
  to: string;
  kind: 'image' | 'document' | 'audio';
  /** URL pública/assinada ou data URI base64. */
  url: string;
  caption?: string;
  fileName?: string;
}

export interface SendResult {
  providerMessageId: string | null;
  raw: unknown;
}

export interface MediaDownload {
  body: Uint8Array;
  contentType: string | null;
}

export interface GroupInfo {
  id: string;
  name: string | null;
  participants: Array<{ phone: string; isAdmin: boolean }>;
  raw: unknown;
}

export interface ConnectionStatus {
  connected: boolean;
  smartphoneConnected: boolean | null;
  error: string | null;
  raw: unknown;
}

export class WhatsappProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    /** Indica se vale a pena tentar de novo (timeout, 5xx, 429). */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WhatsappProviderError';
  }
}
