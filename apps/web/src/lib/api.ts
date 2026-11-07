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

// ───────────── Etapa 2 ─────────────

export type Role = 'owner' | 'admin' | 'staff' | 'viewer';
export const canManage = (role: string | undefined) => role === 'owner' || role === 'admin';
export const canBook = (role: string | undefined) => canManage(role) || role === 'staff';

export interface Occurrence {
  id: string;
  bookingId: string;
  spaceId: string;
  startAt: string;
  endAt: string;
  status: 'tentative' | 'confirmed' | 'cancelled';
  isException: boolean;
  booking: { id: string; title: string | null; responsibleName: string | null; responsiblePhone: string | null; notes: string | null; recurrenceRule: string | null };
  space: { id: string; name: string };
}

export interface Conflict {
  startAt: string;
  endAt: string;
  reason: 'overlap' | 'blocked' | 'outside_hours';
  with?: { title: string | null; responsibleName: string | null; startAt: string; endAt: string };
  block?: { reason: string | null };
}

export interface ApiErrorBody {
  code?: string;
  message: string;
  details?: { conflicts?: Conflict[]; code?: string } | null;
}

export interface BillOccurrence {
  id: string;
  competence: string;
  dueDate: string;
  expectedAmountCents: number | null;
  paidAmountCents: number;
  status: 'pending' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
  paidAt: string | null;
  recurringBill: { id: string; name: string; category: string; isVariableAmount: boolean };
  payments: Array<{ id: string; amountCents: number | null; paidOn: string | null; storageKey: string | null }>;
}

export interface BillsSummary {
  competence: string;
  expectedCents: number;
  paidCents: number;
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  variableWithoutAmount: number;
}

export interface RecurringBill {
  id: string;
  name: string;
  category: string;
  dueDay: number;
  estimatedAmountCents: number | null;
  isVariableAmount: boolean;
  active: boolean;
  suspendedAt: string | null;
  recipientPhones: string[];
}

export interface Reminder {
  id: string;
  title: string;
  message: string | null;
  kind: 'one_time' | 'recurring';
  recurrenceRule: string | null;
  nextRunAt: string | null;
  active: boolean;
  recipientPhones: string[];
}

export interface Overview {
  date: string;
  timezone: string;
  todayBookings: Occurrence[];
  billsDueSoon: BillOccurrence[];
  billsOverdue: BillOccurrence[];
  monthSummary: BillsSummary;
  activeProjects: number;
}

/** Erro da API com o corpo (conflitos de reserva etc.). */
export class ApiBodyError extends ApiError {
  constructor(
    status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(status, body.message);
  }
}

export async function apiSend<T>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Clique duplo/reenvio não cria duas reservas ou dois pagamentos.
      'idempotency-key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    tokenStore.set(null);
    window.dispatchEvent(new Event('coxia:unauthorized'));
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({ message: `Erro ${res.status}` }))) as ApiErrorBody;
  if (!res.ok) throw new ApiBodyError(res.status, json);
  return json as T;
}
