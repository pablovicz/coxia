import type { InboundMessage } from '@coxia/contracts';
import { normalizePhone } from '../phone';
import {
  type ConnectionStatus,
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
      participants?: Array<{ phone?: string; isAdmin?: boolean; isSuperAdmin?: boolean }>;
    };
    return {
      id: raw.phone ?? groupId,
      name: raw.subject ?? null,
      participants: (raw.participants ?? []).flatMap((pt) => {
        const phone = normalizePhone(pt.phone);
        return phone ? [{ phone, isAdmin: pt.isAdmin === true || pt.isSuperAdmin === true }] : [];
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
