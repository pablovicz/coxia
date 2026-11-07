const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000';
const TOKEN_KEY = 'coxia-token';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* sem storage: sessão só em memória */
    }
  },
};

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) {
    tokenStore.set(null);
    window.dispatchEvent(new Event('coxia:unauthorized'));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, body?.message ?? `Erro ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface SessionInfo {
  user: { id: string; name: string; email: string | null; role: string };
  organization: { id: string; name: string; timezone: string };
}

export interface Space {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  capacity: number | null;
  availabilityRules: Array<{ weekday: number; opensAt: string; closesAt: string }>;
}

export interface WhatsappConnection {
  provider: string;
  connected: boolean;
  smartphoneConnected: boolean | null;
  error: string | null;
}
