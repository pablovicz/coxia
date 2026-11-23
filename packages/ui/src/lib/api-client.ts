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
  /** "local" sobrevive a fechar o navegador; "session" some ao fechar a aba. */
  storage: 'local' | 'session';
  /** Evento disparado em `window` quando a sessão acaba (401 sem conseguir renovar). */
  unauthorizedEvent: string;
  /** Rota que troca o refresh token por um par novo (ex.: /auth/refresh). */
  refreshPath?: string;
}

/** Par devolvido pelo login, pela renovação e pela troca de senha. */
export interface SessionTokens {
  accessToken: string;
  refreshToken?: string;
}

export function createApiClient(opts: ApiClientOptions) {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const store = () => (opts.storage === 'local' ? localStorage : sessionStorage);
  const refreshKey = `${opts.tokenKey}-refresh`;

  const read = (key: string): string | null => {
    try {
      return store().getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string | null | undefined) => {
    try {
      if (value) store().setItem(key, value);
      else store().removeItem(key);
    } catch {
      /* sem storage: sessão só em memória */
    }
  };

  const tokenStore = {
    /** Access token atual. */
    get: (): string | null => read(opts.tokenKey),
    getRefresh: (): string | null => read(refreshKey),
    /** Guarda o par (login, renovação, troca de senha). */
    setSession(tokens: SessionTokens) {
      write(opts.tokenKey, tokens.accessToken);
      write(refreshKey, tokens.refreshToken);
    },
    clear() {
      write(opts.tokenKey, null);
      write(refreshKey, null);
    },
  };

  const withAuth = (init: RequestInit, token: string | null): RequestInit => ({
    ...init,
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  let refreshing: Promise<RefreshResult> | null = null;

  /**
   * Renova o access token com o refresh token. Uma renovação por vez, também entre abas (o
   * refresh token troca a cada uso: duas abas com o mesmo token derrubariam a sessão).
   */
  function refresh(expired: string): Promise<RefreshResult> {
    refreshing ??= withLock(`${opts.tokenKey}:refresh`, async () => {
      // Outra aba já renovou enquanto esperávamos.
      const current = tokenStore.get();
      if (current && current !== expired) return 'ok';
      const refreshToken = tokenStore.getRefresh();
      if (!opts.refreshPath || !refreshToken) return 'ended';
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${opts.refreshPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      } catch {
        return 'offline'; // sem rede: mantém a sessão para tentar de novo depois
      }
      if (res.status === 401) return 'ended';
      if (!res.ok) return 'offline'; // api fora do ar: idem
      tokenStore.setSession((await res.json()) as SessionTokens);
      return 'ok';
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** fetch com o Bearer; no 401 renova a sessão e repete uma vez. */
  async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = tokenStore.get();
    const res = await fetch(`${baseUrl}${path}`, withAuth(init, token));
    if (res.status !== 401 || !token) return res;
    const result = await refresh(token);
    if (result === 'offline') return res;
    if (result === 'ok') {
      const retry = await fetch(`${baseUrl}${path}`, withAuth(init, tokenStore.get()));
      if (retry.status !== 401) return retry;
    }
    // Sessão acabou (vencida, revogada, senha trocada): volta para o login.
    tokenStore.clear();
    window.dispatchEvent(new Event(opts.unauthorizedEvent));
    return res;
  }

  /** Logout: revoga a sessão na api (sem esperar) e apaga os tokens. */
  function logout() {
    const refreshToken = tokenStore.getRefresh();
    tokenStore.clear();
    if (refreshToken) {
      void fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }), keepalive: true }).catch(() => undefined);
    }
  }

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await authFetch(path, init);
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
    const res = await authFetch(path, {});
    if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
    return res.blob();
  }

  return { baseUrl, tokenStore, authFetch, logout, api, apiSend, apiBlob };
}

export type ApiClient = ReturnType<typeof createApiClient>;

type RefreshResult = 'ok' | 'ended' | 'offline';

/** Web Locks quando houver (todas as abas); sem suporte, só dentro desta aba. */
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? (locks.request(name, fn) as Promise<T>) : fn();
}
