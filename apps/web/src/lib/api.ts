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
  user: { id: string; memberId?: string; name: string; email: string | null; phone?: string | null; role: string; avatarUpdatedAt?: string | null };
  organization: { id: string; name: string; timezone: string };
}

export interface OpeningRule {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface Space {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  aliases: string[];
  capacity: number | null;
  status: 'available' | 'unavailable' | 'monthly_rental';
  color: string;
  icon: string;
  hourlyRateCents: number | null;
  rentAmountCents: number | null;
  rentDueDay: number | null;
  tenantName: string | null;
  sortOrder: number;
  availabilityRules: OpeningRule[];
  photos: Array<{ id: string; contentType: string; sortOrder: number }>;
}

export const isBookable = (s: Pick<Space, 'status'>) => s.status === 'available';

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
  booking: {
    id: string;
    title: string | null;
    responsibleName: string | null;
    responsiblePhone: string | null;
    contactId?: string | null;
    hourlyRateCents?: number | null;
    groupId?: string | null;
    notes: string | null;
    recurrenceRule: string | null;
  };
  space: { id: string; name: string; color: string; icon: string };
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
  recurringBill: {
    id: string;
    name: string;
    kind?: 'monthly' | 'one_time';
    category: string;
    isVariableAmount: boolean;
    lateFeeCents?: number | null;
    installments?: number | null;
    startsOn?: string;
    payeeName?: string | null;
    paymentDetails?: string | null;
    paymentMethod?: PaymentMethod | null;
    expenseCategory?: ExpenseCategoryRef | null;
  };
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

export interface ExpenseCategoryRef {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface ExpenseCategory extends ExpenseCategoryRef {
  sortOrder: number;
  active: boolean;
}

export interface RecurringBill {
  id: string;
  name: string;
  kind?: 'monthly' | 'one_time';
  category: string;
  expenseCategoryId?: string | null;
  expenseCategory?: ExpenseCategoryRef | null;
  lateFeeCents?: number | null;
  startsOn?: string;
  endsOn?: string | null;
  /** Mensal parcelada: total de parcelas; null = sem fim. */
  installments?: number | null;
  payeeName?: string | null;
  paymentDetails?: string | null;
  paymentMethod?: PaymentMethod | null;
  overdueReminderEveryDays?: number;
  dueDay: number;
  estimatedAmountCents: number | null;
  isVariableAmount: boolean;
  active: boolean;
  suspendedAt: string | null;
  recipientPhones: string[];
}

export type PaymentMethod = 'boleto' | 'pix' | 'credit_card';
export const PAYMENT_METHODS: Record<PaymentMethod, string> = { boleto: 'Boleto', pix: 'PIX', credit_card: 'Cartão de crédito' };

// ───────────── Documentos do projeto ─────────────

export type ProjectDocumentKind = 'document' | 'sketch' | 'receipt';
export const DOCUMENT_KINDS: Record<ProjectDocumentKind, { label: string; plural: string }> = {
  document: { label: 'Documento', plural: 'Documentos' },
  sketch: { label: 'Croqui', plural: 'Croquis' },
  receipt: { label: 'Comprovante', plural: 'Comprovantes' },
};
export const DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export interface ProjectDocument {
  id: string;
  projectId: string;
  kind: ProjectDocumentKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export async function uploadProjectDocument(projectId: string, kind: ProjectDocumentKind, file: File): Promise<ProjectDocument> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/projects/${projectId}/documents?kind=${kind}`, {
    method: 'POST',
    headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  if (res.status === 401) {
    tokenStore.set(null);
    window.dispatchEvent(new Event('coxia:unauthorized'));
  }
  const json = (await res.json().catch(() => ({ message: `Erro ${res.status}` }))) as ApiErrorBody;
  if (!res.ok) throw new ApiBodyError(res.status, json);
  return json as unknown as ProjectDocument;
}

export async function fetchProjectDocument(projectId: string, documentId: string): Promise<Blob> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/projects/${projectId}/documents/${documentId}/file`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
  return res.blob();
}

/** Formulário de novo projeto: prefixo do grupo, WhatsApp e quem entra. */
export interface ProjectGroupInfo {
  prefix: string;
  whatsappConnected: boolean;
  admins: Array<{ userId: string; name: string; hasPhone: boolean; avatarUpdatedAt: string | null }>;
}

export interface CreateProjectResult {
  project: { id: string; title: string };
  groupName: string;
  group:
    | { status: 'created'; groupName: string; invitationLink: string | null; added: number; notAdded: string[]; adminsWithoutPhone: string[] }
    | { status: 'unavailable'; reason: string };
}

/** Um mês na visão unificada do Financeiro. */
export interface FinanceMonth {
  competence: string;
  incomeExpectedCents: number;
  incomeReceivedCents: number;
  billsExpectedCents: number;
  billsPaidCents: number;
  billsOverdue: number;
  incomesOverdue: number;
  variableWithoutAmount: number;
}

export interface FinanceOverview {
  year: number;
  currentCompetence: string;
  months: FinanceMonth[];
  totals: {
    incomeExpectedCents: number;
    incomeReceivedCents: number;
    billsExpectedCents: number;
    billsPaidCents: number;
    billsOverdue: number;
    incomesOverdue: number;
  };
}

/** Detalhe de uma conta (GET /bills/:id/details). */
export interface BillDetails {
  bill: RecurringBill & { createdAt: string };
  createdAt: string;
  createdBy: { name: string | null; channel: string } | null;
  paidCents: number;
  /** null quando há valor variável sem estimativa. */
  outstandingCents: number | null;
  installments: { total: number; paid: number; remaining: number } | null;
  overdue: Array<{
    occurrenceId: string;
    competence: string;
    dueDate: string;
    openCents: number | null;
    lateFeeCents: number | null;
    installment: { number: number; total: number } | null;
  }>;
  overdueCents: number | null;
  occurrences: Array<{
    id: string;
    competence: string;
    dueDate: string;
    status: BillOccurrence['status'];
    expectedAmountCents: number | null;
    paidAmountCents: number;
    paidAt: string | null;
    installment: { number: number; total: number } | null;
    proofs: number;
    payments: Array<{ id: string; amountCents: number | null; paidOn: string | null; hasProof: boolean }>;
  }>;
}

export type ReminderType = 'general' | 'call' | 'message';

export interface Reminder {
  id: string;
  type: ReminderType;
  title: string;
  message: string | null;
  kind: 'one_time' | 'recurring';
  recurrenceRule: string | null;
  dueAt: string | null;
  nextRunAt: string | null;
  lastSentAt: string | null;
  active: boolean;
  recipientPhones: string[];
  personName: string | null;
  personPhone: string | null;
  contact: { id: string; name: string | null; whatsappName: string | null; phone: string } | null;
}

/** Aviso que uma conta já dispara sozinha, mostrado em Lembretes. */
export interface AutomaticReminder {
  billId: string;
  name: string;
  dueDay: number;
  isVariableAmount: boolean;
  overdueEveryDays: number;
  next: { occurrenceId: string; dueDate: string; status: 'pending' | 'partially_paid' | 'overdue'; remainingCents: number | null } | null;
  recipients: Array<{ phone: string; name: string | null }>;
}

export interface Member {
  memberId: string;
  userId: string;
  name: string;
  /** Sem WhatsApp cadastrado: participa, mas não recebe aviso. */
  phone: string | null;
  role: Role;
  avatarUpdatedAt?: string | null;
}

// ───────────── Calendário da equipe (separado da agenda das salas) ─────────────

export type AppointmentKind = 'meeting' | 'visit' | 'event' | 'other';

export interface AppointmentParticipant {
  id: string;
  memberId: string | null;
  contactId: string | null;
  name: string | null;
  phone: string | null;
  member: { id: string; user: { id: string; name: string; phone: string | null; avatarUpdatedAt?: string | null } } | null;
  contact: { id: string; name: string | null; whatsappName: string | null; phone: string } | null;
}

export interface Appointment {
  id: string;
  kind: AppointmentKind;
  title: string;
  location: string | null;
  notes: string | null;
  startAt: string;
  endAt: string;
  allTeam: boolean;
  notifyMinutesBefore: number | null;
  status: 'scheduled' | 'cancelled';
  participants: AppointmentParticipant[];
  project: { id: string; title: string } | null;
}

export interface CalendarReminder {
  reminderId: string;
  at: string;
  type: ReminderType;
  title: string;
  message: string | null;
  recurrenceRule: string | null;
  person: { name: string | null; phone: string | null };
  recipientPhones: string[];
  done: boolean;
  active: boolean;
  project: { id: string; title: string } | null;
}

export interface CalendarBill {
  occurrenceId: string;
  billId: string;
  name: string;
  dueDate: string;
  status: BillOccurrence['status'];
  expectedAmountCents: number | null;
  paidAmountCents: number;
  isVariableAmount: boolean;
  lateFeeCents: number | null;
  payeeName: string | null;
  paymentDetails: string | null;
  paymentMethod: PaymentMethod | null;
  installment: { number: number; total: number } | null;
  category: ExpenseCategoryRef | null;
}

export interface TeamCalendar {
  appointments: Appointment[];
  reminders: CalendarReminder[];
  bills: CalendarBill[];
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
  /** Data de início (YYYY-MM-DD); no futuro, o projeto está "Aguardando". */
  startsOn: string | null;
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
  startsOn: string | null;
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
  quoteRequest: { id: string; name: string; phone: string; email: string; segment: string; services: string[]; neededBy: string | null; createdAt: string } | null;
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
  whatsapp: Array<{ provider: string; phone: string | null; connected: boolean; lastCheckedAt: string | null; lastConnectedAt: string | null; lastError: string | null }>;
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

// ───────────── Salas: fotos ─────────────

/** Envia a foto como corpo bruto (a api confere o tipo pelos bytes). */
export async function uploadSpacePhoto(spaceId: string, file: File): Promise<{ id: string }> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/spaces/${spaceId}/photos`, {
    method: 'POST',
    headers: { 'content-type': file.type, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  if (res.status === 401) {
    tokenStore.set(null);
    window.dispatchEvent(new Event('coxia:unauthorized'));
  }
  const json = (await res.json().catch(() => ({ message: `Erro ${res.status}` }))) as ApiErrorBody;
  if (!res.ok) throw new ApiBodyError(res.status, json);
  return json as unknown as { id: string };
}

/** Foto privada: busca com o token e devolve um blob (o <img> não manda Authorization). */
/** Avatar: foto JPG, PNG ou WebP, até 5 MB. */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export async function uploadAvatar(file: File): Promise<{ avatarUpdatedAt: string }> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/organization/me/avatar`, {
    method: 'POST',
    headers: { 'content-type': file.type, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  if (res.status === 401) {
    tokenStore.set(null);
    window.dispatchEvent(new Event('coxia:unauthorized'));
  }
  const json = (await res.json().catch(() => ({ message: `Erro ${res.status}` }))) as ApiErrorBody;
  if (!res.ok) throw new ApiBodyError(res.status, json);
  return json as unknown as { avatarUpdatedAt: string };
}

export async function fetchAvatar(userId: string, version: string): Promise<Blob> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/organization/users/${userId}/avatar?v=${encodeURIComponent(version)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
  return res.blob();
}

/** Comprovante: foto (JPG, PNG, WebP) ou PDF, até 10 MB. */
export const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

/**
 * Pagamento com comprovante (o arquivo vai como corpo bruto). Conta em aberto: registra o
 * pagamento (sem valor, quita o restante) e a conta fica paga. Conta já paga: só anexa.
 */
export async function payWithProof(occurrenceId: string, file: File, opts: { amountCents?: number | null; paidOn?: string | null } = {}) {
  const token = tokenStore.get();
  const q = new URLSearchParams();
  if (opts.amountCents) q.set('amountCents', String(opts.amountCents));
  if (opts.paidOn) q.set('paidOn', opts.paidOn);
  const res = await fetch(`${API_URL}/bills/occurrences/${occurrenceId}/payments/with-proof${q.size ? `?${q}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': file.type, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  if (res.status === 401) {
    tokenStore.set(null);
    window.dispatchEvent(new Event('coxia:unauthorized'));
  }
  const json = (await res.json().catch(() => ({ message: `Erro ${res.status}` }))) as ApiErrorBody;
  if (!res.ok) throw new ApiBodyError(res.status, json);
  return json;
}

export async function fetchPaymentProof(paymentId: string): Promise<Blob> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/bills/payments/${paymentId}/proof`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
  return res.blob();
}

export async function fetchSpacePhoto(spaceId: string, photoId: string): Promise<Blob> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/spaces/${spaceId}/photos/${photoId}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
  return res.blob();
}

// ───────────── Conexão do WhatsApp ─────────────

export type ConnectCode = { kind: 'qr'; image: string } | { kind: 'code'; code: string } | { kind: 'connected' } | { kind: 'challenge' };

// ───────────── Contatos ─────────────

export interface Contact {
  id: string;
  phone: string;
  /** contato (padrão) ou residente (tem reserva recorrente). */
  kind: 'contact' | 'resident';
  photoUrl: string | null;
  name: string | null;
  whatsappName: string | null;
  notes: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  member: { userId?: string; name: string; role: Role; avatarUpdatedAt?: string | null } | null;
  groups: Array<{ isAdmin: boolean; joinedAt: string; leftAt?: string | null; group: { id: string; name: string | null } }>;
}

export interface ContactGroupOption {
  id: string;
  name: string | null;
  members: number;
}

export const canSeeContacts = (role: string | undefined) => canBook(role);

// ───────────── Entradas ─────────────

export type IncomeSource = 'project' | 'room_rental' | 'other';

export interface Income {
  id: string;
  source: IncomeSource;
  description: string;
  amountCents: number;
  expectedOn: string;
  status: 'expected' | 'received' | 'cancelled';
  receivedOn: string | null;
  receivedAmountCents: number | null;
  payerName: string | null;
  notes: string | null;
  projectId: string | null;
  spaceId: string | null;
  competence: string | null;
  project: { id: string; title: string } | null;
  space: { id: string; name: string; color: string; icon: string } | null;
  contactId?: string | null;
  contact?: { id: string; name: string | null; whatsappName: string | null; resident: { id: string; name: string } | null } | null;
}

// ───────────── Residentes ─────────────

export type ResidentStatus = 'active' | 'disabled';
export type ResidentSituation = 'pending' | 'regular' | 'attention' | 'overdue';

export interface Resident {
  id: string;
  contactId: string;
  name: string;
  description: string | null;
  instagram: string | null;
  email: string | null;
  status: ResidentStatus;
  paymentDay: number | null;
  photoUpdatedAt: string | null;
  contractFileName: string | null;
  contractUploadedAt: string | null;
  contact: { id: string; phone: string; name: string | null; whatsappName: string | null; photoUrl: string | null };
}

export interface ResidentListItem extends Resident {
  situation: ResidentSituation;
  rooms: Array<{ id: string; name: string; color: string; icon: string }>;
}

export interface ResidentDetails {
  resident: Resident;
  situation: ResidentSituation;
  rentals: Array<{
    space: { id: string; name: string; color: string; icon: string };
    schedule: Array<{ bookingId: string; title: string | null; weekdays: string[]; start: string; end: string; since: string | null; until: string | null; hourlyRateCents: number | null }>;
  }>;
  payments: Array<{
    id: string;
    month: string;
    description: string;
    status: 'expected' | 'received' | 'cancelled';
    expectedOn: string;
    receivedOn: string | null;
    amountCents: number;
    overdue: boolean;
    space: { id: string; name: string } | null;
  }>;
  totals: { receivedCents: number; openCents: number };
  firstPaymentMonth: string | null;
  paymentDays: { agreed: number | null; observed: number[] };
}

export const RESIDENT_FILE_TYPES = { photo: ['image/jpeg', 'image/png', 'image/webp'], contract: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] } as const;
export const MAX_RESIDENT_FILE_BYTES = 10 * 1024 * 1024;

export async function uploadResidentFile(residentId: string, kind: 'photo' | 'contract', file: File): Promise<Resident> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/residents/${residentId}/${kind}`, {
    method: 'POST',
    headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  if (res.status === 401) {
    tokenStore.set(null);
    window.dispatchEvent(new Event('coxia:unauthorized'));
  }
  const json = (await res.json().catch(() => ({ message: `Erro ${res.status}` }))) as ApiErrorBody;
  if (!res.ok) throw new ApiBodyError(res.status, json);
  return json as unknown as Resident;
}

export async function fetchResidentFile(residentId: string, kind: 'photo' | 'contract', version: string): Promise<Blob> {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/residents/${residentId}/${kind}?v=${encodeURIComponent(version)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Erro ${res.status}`);
  return res.blob();
}

export interface IncomesSummary {
  competence: string;
  expectedCents: number;
  receivedCents: number;
  total: number;
  received: number;
  overdue: number;
}

// ───────────── Equipe ─────────────

export interface TeamMember {
  id: string;
  role: Role;
  canManageProjects: boolean;
  receivesMorningBriefing: boolean;
  createdAt: string;
  user: { id: string; name: string; email: string | null; phone: string | null; avatarUpdatedAt?: string | null };
}

// ───────────── Pedidos de orçamento (site casakaju.com) ─────────────

export type QuoteRequestStatus = 'new' | 'contacted' | 'approved' | 'archived';

export interface QuoteRequest {
  id: string;
  contactId: string | null;
  name: string;
  email: string;
  phone: string;
  segment: string;
  services: string[];
  description: string;
  neededBy: string | null;
  status: QuoteRequestStatus;
  notes: string | null;
  source: string;
  projectId: string | null;
  project: { id: string; title: string } | null;
  /** Rascunho para "Promover a projeto" (nome e objetivo com os dados do pedido). */
  projectDraft: { title: string; objective: string };
  createdAt: string;
  updatedAt: string;
}

export interface QuoteRequestList {
  items: QuoteRequest[];
  counts: Record<QuoteRequestStatus, number>;
}

export const QUOTE_SEGMENTS: Record<string, string> = {
  theater: 'Teatro',
  audiovisual: 'Audiovisual',
  large_event: 'Shows / eventos de grande porte',
  private_event: 'Evento particular',
  other: 'Outro',
};

export const QUOTE_SERVICES: Record<string, string> = {
  costume: 'Figurino',
  set_design: 'Cenografia',
  lighting: 'Iluminação',
  props: 'Adereços',
  puppets: 'Bonecos',
  space_rental: 'Aluguel de espaço',
  course: 'Cursos',
  other: 'Outro',
};

export const QUOTE_STATUS: Record<QuoteRequestStatus, { label: string; tab: string; variant: 'info' | 'pending' | 'active' | 'archived' }> = {
  new: { label: 'Novo', tab: 'Novos', variant: 'info' },
  contacted: { label: 'Em conversa', tab: 'Em conversa', variant: 'pending' },
  approved: { label: 'Aprovado', tab: 'Aprovados', variant: 'active' },
  archived: { label: 'Arquivado', tab: 'Arquivados', variant: 'archived' },
};
