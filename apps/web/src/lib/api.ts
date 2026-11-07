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
  projectsToReview: number;
}

// ───────────── Etapa 3: projetos ─────────────

export type ProjectStatus = 'draft' | 'active' | 'closing' | 'closed';
export type TaskStatus = 'proposed' | 'open' | 'done' | 'cancelled';
export type ExpenseStatus = 'proposed' | 'confirmed' | 'paid' | 'rejected';

export interface ProjectListItem {
  id: string;
  title: string;
  status: ProjectStatus;
  groupName: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  estimatedBudgetCents: number | null;
  openTasks: number;
  overdueTasks: number;
  toReview: number;
  paidCents: number;
}

/** Mensagem de origem mostrada como evidência na revisão. */
export interface Evidence {
  messageId: string;
  authorName: string | null;
  authorPhone: string | null;
  sentAt: string;
  text: string | null;
  attachmentKind: string | null;
}

export interface ProjectTask {
  id: string;
  title: string;
  assigneeName: string | null;
  dueDate: string | null;
  status: TaskStatus;
  completedAt: string | null;
  source: Evidence | null;
}

export interface ProjectExpense {
  id: string;
  kind: 'quote' | 'expense';
  description: string;
  vendor: string | null;
  amountCents: number | null;
  status: ExpenseStatus;
  hasProof: boolean;
  paidAt: string | null;
  confirmedAt: string | null;
  source: Evidence | null;
}

export type SuggestionPayload =
  | { type: 'decision'; summary: string }
  | { type: 'question'; question: string }
  | { type: 'task_done'; taskTitle: string };

export interface ProjectSuggestion {
  id: string;
  type: 'decision' | 'question' | 'task_done';
  payload: SuggestionPayload;
  confidence: number | null;
  createdAt: string;
  source: Evidence | null;
}

export interface ProjectBriefing {
  title: string | null;
  objective: string | null;
  deliverables: string[];
  deadlines: Array<{ description: string; date: string | null }>;
  owners: Array<{ name: string; responsibility: string | null }>;
  estimatedBudgetCents: number | null;
  openQuestions: string[];
  proposedTasks: Array<{ title: string; assigneeName: string | null; dueDate: string | null }>;
}

export interface ProjectDetail {
  id: string;
  title: string;
  status: ProjectStatus;
  objective: string | null;
  briefing: ProjectBriefing | null;
  estimatedBudgetCents: number | null;
  groupCheckIns: boolean;
  groupName: string | null;
  activatedAt: string | null;
  closingRequestedAt: string | null;
  closedAt: string | null;
  totals: { paidCents: number; committedCents: number; proposedCents: number };
  pendingReview: number;
  tasks: ProjectTask[];
  expenses: ProjectExpense[];
  decisions: Array<{ id: string; summary: string; decidedAt: string }>;
  suggestions: ProjectSuggestion[];
  summaries: Array<{ id: string; kind: string; content: string; generatedAt: string }>;
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

// ───────────── Etapa 4: operação ─────────────

export interface OpsOverview {
  generatedAt: string;
  whatsapp: Array<{ provider: string; connected: boolean; lastCheckedAt: string | null; lastConnectedAt: string | null; lastError: string | null }>;
  lastInboundAt: string | null;
  inbound: {
    last24h: Record<'received' | 'queued' | 'processing' | 'processed' | 'ignored' | 'failed', number>;
    oldestPendingSeconds: number;
  };
  outbox: {
    byStatus: Record<'pending' | 'sending' | 'failed' | 'sent' | 'dead', number>;
    sentLast24h: number;
    oldestPendingSeconds: number;
  };
  ai: Array<{ operation: string; calls: number; failures: number; inputTokens: number; outputTokens: number; avgLatencyMs: number }>;
  retention: { days: number; lastRunAt: string | null; result: { messages?: number; files?: number } | null };
}

export interface FailedMessage {
  id: string;
  kind: string;
  senderName: string | null;
  senderPhone: string | null;
  receivedAt: string;
  processingError: string | null;
  conversation: { isGroup: boolean; group: { name: string | null } | null };
}

export interface DeadDelivery {
  id: string;
  recipient: string;
  text: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}
