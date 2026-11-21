/** Cliente HTTP dos painéis: Bearer token, idempotency-key nas escritas e erro com o corpo da api. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiErrorBody {
  statusCode?: number;
  code?: string;
  message: string;
  details?: unknown;
}

/** Erro da api com o corpo (código, conflitos, saldo insuficiente...). */
export class ApiBodyError extends ApiError {
  constructor(
    status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(status, body.message);
  }

  /** `details.code` do domínio (ex.: insufficient_hours, cycle_closed). */
  get code(): string | undefined {
    const d = this.body.details as { code?: string } | null | undefined;
    return d?.code ?? undefined;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenKey: string;
  /** "local" sobrevive a fechar o navegador (residente no celular); "session" some ao fechar a aba. */
  storage: 'local' | 'session';
  /** Evento disparado em `window` quando a api responde 401. */
  unauthorizedEvent: string;
}

export function createApiClient(opts: ApiClientOptions) {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const store = () => (opts.storage === 'local' ? localStorage : sessionStorage);

  const tokenStore = {
    get(): string | null {
      try {
        return store().getItem(opts.tokenKey);
      } catch {
        return null;
      }
    },
    set(token: string | null) {
      try {
        if (token) store().setItem(opts.tokenKey, token);
        else store().removeItem(opts.tokenKey);
      } catch {
        /* sem storage: sessão só em memória */
      }
    },
  };

  async function request(path: string, init: RequestInit): Promise<Response> {
    const token = tokenStore.get();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (res.status === 401 && token) {
      tokenStore.set(null);
      window.dispatchEvent(new Event(opts.unauthorizedEvent));
    }
    return res;
  }

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await request(path, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiBodyError(res.status, body ?? { message: `Erro ${res.status}` });
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function apiSend<T>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
    // Clique duplo/reenvio não cria duas reservas.
    return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'idempotency-key': crypto.randomUUID() } });
  }

  async function apiBlob(path: string): Promise<Blob> {
    const res = await request(path, {});
    if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
    return res.blob();
  }

  return { baseUrl, tokenStore, api, apiSend, apiBlob };
}

export type ApiClient = ReturnType<typeof createApiClient>;
