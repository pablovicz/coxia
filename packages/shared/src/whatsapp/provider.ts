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
  /** QR code para conectar o número (expira em ~20 s; pedir de novo a cada 15 s). */
  getQrCode(): Promise<ConnectCode>;
  /** Código de pareamento para conectar digitando no celular, em vez de ler o QR. */
  getPhoneCode(phone: string): Promise<ConnectCode>;
  /** Nome e foto do perfil de um número no WhatsApp (null se o número não tem WhatsApp). */
  getContactProfile(phone: string): Promise<ContactProfile | null>;
  /** Encerra a sessão do número na instância (para conectar outro número ou cortar o acesso). */
  disconnect(): Promise<void>;
}

/**
 * Resultado de um pedido de conexão:
 * - qr: imagem (data URI) para exibir;
 * - code: código para digitar em "Conectar com número de telefone";
 * - connected: a sessão já está ativa;
 * - challenge: o aparelho pediu a chave de acesso (passkey), que só o painel do provedor conclui.
 */
export type ConnectCode =
  | { kind: 'qr'; image: string }
  | { kind: 'code'; code: string }
  | { kind: 'connected' }
  | { kind: 'challenge' };

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
  participants: Array<{ phone: string; isAdmin: boolean; name: string | null }>;
  raw: unknown;
}

export interface ContactProfile {
  /** Nome que a pessoa usa no WhatsApp (ou o salvo na agenda do celular da Coxia). */
  name: string | null;
  /** URL da foto (temporária, do próprio WhatsApp); null sem foto ou privada. */
  photoUrl: string | null;
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
