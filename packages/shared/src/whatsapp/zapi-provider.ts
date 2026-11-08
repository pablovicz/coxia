import type { InboundMessage } from '@coxia/contracts';
import { normalizePhone } from '../phone';
import {
  type ConnectCode,
  type ConnectionStatus,
  type ContactProfile,
  type GroupInfo,
  type MediaDownload,
  type SendMediaInput,
  type SendResult,
  type SendTextInput,
  type WhatsappProvider,
  WhatsappProviderError,
} from './provider';
import { normalizeZapiWebhook } from './zapi-normalizer';

export interface ZapiConfig {
  baseUrl: string;
  instanceId: string;
  instanceToken: string;
  /** Token de segurança da conta (header Client-Token). */
  clientToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Adaptador Z-API. Integração baseada em sessão do WhatsApp: há risco de desconexão,
 * por isso `checkConnection` é monitorado e erros são classificados como retentáveis ou não.
 */
export class ZapiProvider implements WhatsappProvider {
  readonly name: InboundMessage['provider'] = 'zapi';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: ZapiConfig) {
    if (!config.instanceId || !config.instanceToken) {
      throw new Error('Z-API: ZAPI_INSTANCE_ID e ZAPI_INSTANCE_TOKEN são obrigatórios');
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  receiveWebhook(payload: unknown): InboundMessage | null {
    return normalizeZapiWebhook(payload);
  }

  async sendText({ to, text }: SendTextInput): Promise<SendResult> {
    const raw = await this.request('POST', 'send-text', { phone: to, message: text });
    return { providerMessageId: pickMessageId(raw), raw };
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    let raw: unknown;
    if (input.kind === 'image') {
      raw = await this.request('POST', 'send-image', {
        phone: input.to,
        image: input.url,
        caption: input.caption,
      });
    } else if (input.kind === 'audio') {
      raw = await this.request('POST', 'send-audio', { phone: input.to, audio: input.url });
    } else {
      const ext = (input.fileName?.split('.').pop() ?? 'pdf').toLowerCase();
      raw = await this.request('POST', `send-document/${encodeURIComponent(ext)}`, {
        phone: input.to,
        document: input.url,
        fileName: input.fileName,
        caption: input.caption,
      });
    }
    return { providerMessageId: pickMessageId(raw), raw };
  }

  /** As URLs de mídia da Z-API são temporárias: o worker deve copiar para o bucket logo. */
  async getMedia(url: string): Promise<MediaDownload> {
    const res = await this.withTimeout((signal) => this.fetchImpl(url, { signal }));
    if (!res.ok) {
      throw new WhatsappProviderError(`download de mídia falhou: ${res.status}`, res.status, res.status >= 500);
    }
    return {
      body: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type'),
    };
  }

  async getGroupInfo(groupId: string): Promise<GroupInfo> {
    const raw = (await this.request('GET', `group-metadata/${encodeURIComponent(groupId)}`)) as {
      phone?: string;
      subject?: string;
      participants?: Array<{ phone?: string; isAdmin?: boolean; isSuperAdmin?: boolean; name?: string; short?: string }>;
    };
    return {
      id: raw.phone ?? groupId,
      name: raw.subject ?? null,
      participants: (raw.participants ?? []).flatMap((pt) => {
        const phone = normalizePhone(pt.phone);
        const name = (pt.name ?? pt.short ?? '').trim() || null;
        return phone ? [{ phone, isAdmin: pt.isAdmin === true || pt.isSuperAdmin === true, name }] : [];
      }),
      raw,
    };
  }

  async checkConnection(): Promise<ConnectionStatus> {
    const raw = (await this.request('GET', 'status')) as {
      connected?: boolean;
      smartphoneConnected?: boolean;
      error?: string;
    };
    return {
      connected: raw.connected === true,
      smartphoneConnected: typeof raw.smartphoneConnected === 'boolean' ? raw.smartphoneConnected : null,
      error: raw.error ?? null,
      raw,
    };
  }

  async getQrCode(): Promise<ConnectCode> {
    const raw = (await this.request('GET', 'qr-code/image')) as { value?: string; connected?: boolean; challenge?: unknown };
    return toConnectCode(raw, 'qr');
  }

  async getPhoneCode(phone: string): Promise<ConnectCode> {
    const digits = normalizePhone(phone);
    if (!digits) throw new WhatsappProviderError('Telefone inválido', 400, false);
    const raw = (await this.request('GET', `phone-code/${digits}`)) as { value?: string; connected?: boolean; challenge?: unknown };
    return toConnectCode(raw, 'code');
  }

  /** contacts/{phone}: nome (notify = o que a pessoa usa) e foto; 404 = número sem WhatsApp. */
  async getContactProfile(phone: string): Promise<ContactProfile | null> {
    const digits = normalizePhone(phone);
    if (!digits) return null;
    let raw: { name?: string | null; notify?: string | null; short?: string | null; imgUrl?: string | null };
    try {
      raw = (await this.request('GET', `contacts/${digits}`)) as typeof raw;
    } catch (err) {
      if (err instanceof WhatsappProviderError && err.status === 404) return null;
      throw err;
    }
    const name = [raw.notify, raw.name, raw.short].map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) ?? null;
    const photoUrl = typeof raw.imgUrl === 'string' && raw.imgUrl.startsWith('https://') ? raw.imgUrl : null;
    return { name, photoUrl };
  }

  async disconnect(): Promise<void> {
    const raw = (await this.request('GET', 'disconnect')) as { value?: boolean };
    if (raw.value === false) throw new WhatsappProviderError('Z-API disconnect: a instância recusou', null, true);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const { baseUrl, instanceId, instanceToken, clientToken } = this.config;
    const url = `${baseUrl.replace(/\/$/, '')}/instances/${instanceId}/token/${instanceToken}/${path}`;
    let res: Response;
    try {
      res = await this.withTimeout((signal) =>
        this.fetchImpl(url, {
          method,
          signal,
          headers: {
            'content-type': 'application/json',
            ...(clientToken ? { 'client-token': clientToken } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    } catch (err) {
      throw new WhatsappProviderError(`Z-API ${path}: ${(err as Error).message}`, null, true);
    }
    const text = await res.text();
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      // Nunca inclua a URL (contém o token da instância) na mensagem de erro.
      throw new WhatsappProviderError(`Z-API ${path}: HTTP ${res.status} ${text.slice(0, 200)}`, res.status, retryable);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { raw: text };
    }
  }

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

function pickMessageId(raw: unknown): string | null {
  const r = raw as { messageId?: unknown; zaapId?: unknown; id?: unknown } | null;
  const id = r?.messageId ?? r?.id ?? r?.zaapId;
  return typeof id === 'string' ? id : null;
}

/** Respostas de qr-code/image e phone-code: valor, sessão já conectada ou desafio de passkey. */
export function toConnectCode(raw: { value?: string; connected?: boolean; challenge?: unknown }, kind: 'qr' | 'code'): ConnectCode {
  if (raw.challenge) return { kind: 'challenge' };
  if (raw.connected === true) return { kind: 'connected' };
  const value = typeof raw.value === 'string' ? raw.value.trim() : '';
  if (!value) throw new WhatsappProviderError(`Z-API: resposta sem ${kind === 'qr' ? 'QR code' : 'código'}`, null, true);
  if (kind === 'code') return { kind: 'code', code: value };
  return { kind: 'qr', image: value.startsWith('data:') ? value : `data:image/png;base64,${value}` };
}
