import { expect, type Page, test } from '@playwright/test';

/**
 * Golden visual + interação. A API é simulada (http://api.mock) para resultados determinísticos;
 * o relógio é fixado em sexta, 06/11/2026, 09:00 em São Paulo.
 */
const NOW = new Date('2026-11-06T12:00:00Z');

const SESSION = {
  user: { id: 'u1', memberId: 'mb1', name: 'Ana Admin', email: 'ana@casakaju.test', phone: '5511900001111', role: 'owner' },
  organization: { id: 'o1', name: 'Casa Kaju', timezone: 'America/Sao_Paulo' },
};
const rules = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '22:00' }));
const room = (id: string, name: string, color: string, icon: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  slug: id,
  aliases: [],
  capacity: null,
  description: null,
  status: 'available',
  color,
  icon,
  sortOrder: Number(id.slice(1)),
  hourlyRateCents: null as number | null,
  rentAmountCents: null as number | null,
  rentDueDay: null as number | null,
  tenantName: null as string | null,
  availabilityRules: rules,
  photos: [] as Array<{ id: string; contentType: string; sortOrder: number }>,
  ...extra,
});
const SPACES = [
  room('s1', 'Sala Grande', 'floresta', 'palco', {
    hourlyRateCents: 12000,
    description: 'Palco de 6 m, 80 lugares, som e luz. Ideal para ensaios abertos e apresentações.',
    photos: [
      { id: 'ph1', contentType: 'image/svg+xml', sortOrder: 0 },
      { id: 'ph2', contentType: 'image/svg+xml', sortOrder: 1 },
    ],
  }),
  room('s2', 'Sala Média', 'terracota', 'musica', { hourlyRateCents: 8000, description: 'Piso de madeira e espelho. Boa para dança, oficinas e reuniões.' }),
  room('s3', 'Sala Pequena', 'azul', 'poltrona', {
    availabilityRules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '09:00', closesAt: '18:00' })),
  }),
  room('s4', 'Ateliê do Jardim', 'petroleo', 'jardim', {
    status: 'monthly_rental',
    rentAmountCents: 180000,
    rentDueDay: 10,
    tenantName: 'Coletivo Barro',
    description: 'Alugado para o Coletivo Barro até março de 2027.',
  }),
];

/** "Foto" determinística para os goldens (o bucket real só aceita JPG/PNG/WebP). */
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e7c879"/><stop offset="1" stop-color="#d86e4b"/></linearGradient></defs>
<rect width="640" height="360" fill="url(#g)"/><rect y="250" width="640" height="110" fill="#4f3436" opacity=".85"/>
<rect x="80" y="60" width="480" height="190" fill="#263b30" opacity=".25"/><circle cx="320" cy="150" r="46" fill="#fffdf8" opacity=".6"/></svg>`;

const occ = (id: string, space: number, day: string, start: string, end: string, title: string | null, who: string | null, weekly = false) => ({
  id,
  bookingId: `b-${id}`,
  spaceId: SPACES[space]!.id,
  startAt: `2026-11-${day}T${start}:00-03:00`,
  endAt: `2026-11-${day}T${end}:00-03:00`,
  status: 'confirmed',
  isException: false,
  booking: { id: `b-${id}`, title, responsibleName: who, responsiblePhone: null, notes: null, recurrenceRule: weekly ? 'FREQ=WEEKLY;BYDAY=TU' : null },
  space: { id: SPACES[space]!.id, name: SPACES[space]!.name, color: SPACES[space]!.color, icon: SPACES[space]!.icon },
});

/** Reserva em qualquer data (visões de mês, trimestre e ano). */
const occOn = (id: string, space: number, date: string, start: string, end: string, title: string) => ({
  ...occ(id, space, '01', start, end, title, null),
  startAt: `${date}T${start}:00-03:00`,
  endAt: `${date}T${end}:00-03:00`,
});

const BOOKINGS = [
  occ('o1', 0, '02', '09:00', '11:00', 'Ensaio', 'Micaela'),
  occ('o2', 1, '03', '14:00', '17:00', 'Oficina de cerâmica', 'Bruno'),
  occ('o3', 2, '03', '19:00', '21:00', 'Dança', null, true),
  occ('o4', 0, '06', '09:00', '12:00', 'Ensaio geral', 'Micaela'),
  occ('o5', 2, '06', '14:00', '15:30', 'Reunião de produção', 'Ana'),
  occ('o6', 1, '06', '19:00', '21:30', 'Teatro', 'Coletivo Lume', true),
  occ('o7', 2, '07', '10:00', '13:00', 'Ateliê', null),
  occOn('o8', 0, '2026-11-12', '19:00', '22:00', 'Estreia'),
  occOn('o9', 1, '2026-11-12', '14:00', '16:00', 'Oficina de máscaras'),
  occOn('o10', 2, '2026-11-12', '10:00', '11:00', 'Reunião'),
  occOn('o11', 1, '2026-11-12', '17:00', '18:00', 'Aula de voz'),
  occOn('o12', 1, '2026-11-18', '09:00', '12:00', 'Oficina de cerâmica'),
  occOn('o13', 0, '2026-11-25', '19:00', '21:00', 'Leitura dramática'),
  occOn('o14', 0, '2026-10-15', '19:00', '21:00', 'Ensaio'),
  occOn('o15', 2, '2026-10-22', '10:00', '12:00', 'Reunião de produção'),
  occOn('o16', 1, '2026-12-05', '14:00', '18:00', 'Mostra de fim de ano'),
  occOn('o17', 0, '2026-12-12', '19:00', '22:00', 'Festa da Casa'),
];
const today = BOOKINGS.filter((b) => b.startAt.startsWith('2026-11-06'));

const CAT_CASA = { id: 'ec1', name: 'Casa', icon: 'casa', color: 'floresta' };
const CAT_ESTOQUE = { id: 'ec2', name: 'Estoque', icon: 'estoque', color: 'mostarda' };
const CAT_MANUT = { id: 'ec3', name: 'Manutenção', icon: 'manutencao', color: 'terracota' };
const EXPENSE_CATEGORIES = [CAT_CASA, CAT_ESTOQUE, CAT_MANUT].map((c, i) => ({ ...c, sortOrder: i + 1, active: true }));

const bill = (id: string, name: string, due: string, expected: number | null, paid: number, status: string) => ({
  id,
  competence: '2026-11',
  dueDate: `2026-11-${due}T00:00:00.000Z`,
  expectedAmountCents: expected,
  paidAmountCents: paid,
  status,
  paidAt: null,
  recurringBill: {
    id: `rb-${id}`,
    name,
    kind: 'monthly',
    category: 'outros',
    isVariableAmount: expected === null,
    lateFeeCents: name === 'Água' ? 1500 : null,
    expenseCategory: CAT_CASA,
  },
  payments: [],
});
const ONE_OFF = {
  ...bill('c6', 'Compra de copos', '18', 45000, 0, 'pending'),
  recurringBill: { id: 'rb-c6', name: 'Compra de copos', kind: 'one_time', category: 'outros', isVariableAmount: false, lateFeeCents: null, expenseCategory: CAT_ESTOQUE },
};

const BILLS = [
  bill('c1', 'Aluguel', '05', 250000, 250000, 'paid'),
  bill('c2', 'Energia elétrica', '07', null, 0, 'pending'),
  bill('c3', 'Água', '04', 9000, 3000, 'overdue'),
  bill('c4', 'Internet', '20', 14990, 0, 'pending'),
  bill('c5', 'Telefone', '30', 9900, 0, 'pending'),
];
const SUMMARY = { competence: '2026-11', expectedCents: 283890, paidCents: 253000, total: 5, paid: 1, pending: 3, overdue: 1, variableWithoutAmount: 1 };
const RECURRING = [
  { id: 'rb1', name: 'Aluguel', kind: 'monthly', category: 'aluguel', dueDay: 5, estimatedAmountCents: 250000, lateFeeCents: 5000, isVariableAmount: false, active: true, suspendedAt: null, recipientPhones: [], expenseCategoryId: 'ec1', expenseCategory: CAT_CASA },
  { id: 'rb2', name: 'Energia elétrica', kind: 'monthly', category: 'energia', dueDay: 7, estimatedAmountCents: 32000, isVariableAmount: true, active: true, suspendedAt: null, recipientPhones: [], expenseCategoryId: 'ec1', expenseCategory: CAT_CASA },
  { id: 'rb3', name: 'Gás', kind: 'monthly', category: 'outros', dueDay: 31, estimatedAmountCents: 5000, isVariableAmount: false, active: false, suspendedAt: '2026-10-01T00:00:00Z', recipientPhones: [], expenseCategoryId: 'ec3', expenseCategory: CAT_MANUT },
];
const reminder = (r: Record<string, unknown>) => ({
  type: 'general',
  message: null,
  kind: 'one_time',
  recurrenceRule: null,
  dueAt: r.nextRunAt ?? null,
  lastSentAt: null,
  active: true,
  recipientPhones: ['5511900001111'],
  personName: null,
  personPhone: null,
  contact: null,
  ...r,
});
const REMINDERS = [
  reminder({
    id: 'r3',
    type: 'call',
    title: 'Ligar para Carla (iluminação)',
    nextRunAt: '2026-11-06T17:00:00Z',
    message: 'Confirmar a luz da estreia',
    contact: { id: 'k2', name: 'Carla (iluminação)', whatsappName: 'Carla Mendes', phone: '5511987650002' },
  }),
  reminder({ id: 'r4', type: 'message', title: 'Mandar mensagem para Seu Zé do som', nextRunAt: '2026-11-07T13:30:00Z', personName: 'Seu Zé do som', personPhone: '551133334444' }),
  reminder({ id: 'r1', title: 'Renovar alvará', nextRunAt: '2026-11-10T12:00:00Z' }),
  reminder({ id: 'r2', title: 'Abrir a casa', kind: 'recurring', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', nextRunAt: '2026-11-09T10:30:00Z' }),
  reminder({ id: 'r5', title: 'Pagar o técnico de som', active: false, nextRunAt: null, dueAt: '2026-11-03T15:00:00Z', lastSentAt: '2026-11-03T15:00:00Z' }),
];
const AUTOMATIC = [
  { billId: 'rb2', name: 'Energia elétrica', dueDay: 7, isVariableAmount: true, overdueEveryDays: 3, next: { occurrenceId: 'c2', dueDate: '2026-11-07', status: 'pending', remainingCents: 32000 }, recipients: [{ phone: '5511900001111', name: 'Ana Admin' }] },
  { billId: 'rb4', name: 'Água', dueDay: 4, isVariableAmount: true, overdueEveryDays: 3, next: { occurrenceId: 'c3', dueDate: '2026-11-04', status: 'overdue', remainingCents: 6000 }, recipients: [] },
  { billId: 'rb5', name: 'Internet', dueDay: 20, isVariableAmount: false, overdueEveryDays: 3, next: { occurrenceId: 'c4', dueDate: '2026-11-20', status: 'pending', remainingCents: 14990 }, recipients: [{ phone: '5511900001111', name: 'Ana Admin' }] },
];
const income = (r: Record<string, unknown>) => ({
  source: 'other',
  status: 'expected',
  receivedOn: null,
  receivedAmountCents: null,
  payerName: null,
  notes: null,
  projectId: null,
  spaceId: null,
  competence: null,
  project: null,
  space: null,
  ...r,
});
const INCOMES = [
  income({ id: 'i0', description: 'Oficina de outubro', amountCents: 45000, expectedOn: '2026-10-28', payerName: 'Escola Aurora' }),
  income({
    id: 'i1',
    source: 'project',
    description: 'Patrocínio — 2ª parcela',
    amountCents: 500000,
    expectedOn: '2026-11-05',
    status: 'received',
    receivedOn: '2026-11-05',
    receivedAmountCents: 500000,
    payerName: 'Lei de Incentivo',
    projectId: 'p1',
    project: { id: 'p1', title: 'XPO' },
  }),
  income({
    id: 'i2',
    source: 'room_rental',
    description: 'Aluguel Ateliê do Jardim',
    amountCents: 180000,
    expectedOn: '2026-11-10',
    payerName: 'Coletivo Barro',
    spaceId: 's4',
    competence: '2026-11',
    space: { id: 's4', name: 'Ateliê do Jardim', color: 'petroleo', icon: 'jardim' },
  }),
  income({
    id: 'i3',
    source: 'room_rental',
    description: 'Ensaio fotográfico',
    amountCents: 60000,
    expectedOn: '2026-11-14',
    spaceId: 's1',
    space: { id: 's1', name: 'Sala Grande', color: 'floresta', icon: 'palco' },
  }),
  income({ id: 'i4', source: 'project', description: 'Bilheteria da estreia', amountCents: 320000, expectedOn: '2026-11-28', projectId: 'p1', project: { id: 'p1', title: 'XPO' } }),
];
const INCOME_SUMMARY = { competence: '2026-11', expectedCents: 1060000, receivedCents: 500000, total: 4, received: 1, overdue: 1 };

const TEAM = [
  { id: 'mb1', role: 'owner', canManageProjects: true, receivesMorningBriefing: true, createdAt: '2026-08-01T12:00:00Z', user: { id: 'u1', name: 'Ana Admin', email: 'ana@casakaju.test', phone: '5511900001111' } },
  { id: 'mb2', role: 'admin', canManageProjects: true, receivesMorningBriefing: false, createdAt: '2026-08-01T12:00:00Z', user: { id: 'u3', name: 'Julia', email: 'julia@casakaju.test', phone: null } },
  { id: 'mb3', role: 'staff', canManageProjects: false, receivesMorningBriefing: false, createdAt: '2026-08-01T12:00:00Z', user: { id: 'u2', name: 'Bruno Lima', email: 'bruno@casakaju.test', phone: '5511900002222' } },
];

const MEMBERS = [
  { userId: 'u1', name: 'Ana Admin', phone: '5511900001111', role: 'owner' },
  { userId: 'u2', name: 'Bruno Lima', phone: '5511900002222', role: 'staff' },
];

const ev = (who: string, at: string, text: string | null, attachmentKind: string | null = null) => ({
  messageId: `m-${at}`,
  authorName: who,
  authorPhone: null,
  sentAt: at,
  text,
  attachmentKind,
});
const task = (id: string, title: string, status: string, assigneeName: string | null, dueDate: string | null, source: unknown = null) => ({
  id,
  title,
  assigneeName,
  dueDate,
  status,
  completedAt: status === 'done' ? '2026-11-05T15:00:00Z' : null,
  source,
});
const expense = (id: string, kind: string, description: string, amountCents: number | null, status: string, hasProof: boolean, source: unknown = null) => ({
  id,
  kind,
  description,
  vendor: null,
  amountCents,
  status,
  hasProof,
  paidAt: status === 'paid' ? '2026-11-05T18:00:00Z' : null,
  confirmedAt: null,
  source,
});
const PROJECTS = [
  { id: 'p1', title: 'XPO', status: 'active', groupName: 'PROJETO - XPO', activatedAt: '2026-11-02T13:00:00Z', closedAt: null, estimatedBudgetCents: 800000, openTasks: 3, overdueTasks: 1, toReview: 4, paidCents: 48000 },
  { id: 'p2', title: 'Mostra de Dança', status: 'closing', groupName: 'PROJETO - Mostra de Dança', activatedAt: '2026-10-10T13:00:00Z', closedAt: null, estimatedBudgetCents: null, openTasks: 1, overdueTasks: 0, toReview: 0, paidCents: 0 },
  { id: 'p3', title: 'Sarau de Verão', status: 'closed', groupName: 'PROJETO - Sarau', activatedAt: '2026-09-01T13:00:00Z', closedAt: '2026-10-20T21:00:00Z', estimatedBudgetCents: 300000, openTasks: 0, overdueTasks: 0, toReview: 0, paidCents: 285000 },
];
const PROJECT_XPO = {
  id: 'p1',
  title: 'XPO',
  status: 'active',
  objective: 'Mostra de fim de ano dos alunos de dança',
  briefing: {
    title: 'Mostra de fim de ano',
    objective: 'Mostra de fim de ano dos alunos de dança',
    deliverables: ['Cartaz', 'Sonorização'],
    deadlines: [
      { description: 'Cartaz pronto', date: '2026-11-11' },
      { description: 'Mostra', date: '2026-12-12' },
    ],
    owners: [
      { name: 'Bruno', responsibility: 'Cartaz' },
      { name: 'Ana', responsibility: 'Som' },
    ],
    estimatedBudgetCents: 800000,
    openQuestions: ['Vai ter venda de ingresso?'],
    proposedTasks: [],
  },
  estimatedBudgetCents: 800000,
  groupCheckIns: true,
  groupName: 'PROJETO - XPO',
  activatedAt: '2026-11-02T13:00:00Z',
  closingRequestedAt: null,
  closedAt: null,
  totals: { paidCents: 48000, committedCents: 90000, proposedCents: 250000 },
  pendingReview: 4,
  tasks: [
    task('t1', 'Fazer o cartaz', 'open', 'Bruno', '2026-11-04', ev('Bruno Produção', '2026-11-02T14:10:00Z', 'Eu fecho o cartaz até quarta')),
    task('t2', 'Fechar o som', 'open', 'Ana', '2026-11-12'),
    task('t3', 'Confirmar o buffet', 'open', null, null),
    task('t4', 'Ver a luz do palco', 'proposed', null, null, ev('Bruno Produção', '2026-11-05T19:20:00Z', 'Seria bom alguém ver a luz do palco')),
    task('t5', 'Reservar a sala grande', 'done', 'Ana', '2026-11-03'),
  ],
  expenses: [
    expense('e1', 'quote', 'Sonorização', 250000, 'proposed', false, ev('Ana Admin', '2026-11-05T20:02:00Z', 'Orçamento do som chegou: R$ 2.500, ainda não aprovado')),
    expense('e2', 'expense', 'Gráfica', 48000, 'proposed', true, ev('Bruno Produção', '2026-11-06T11:30:00Z', 'Paguei a gráfica, R$ 480,00', 'image')),
    expense('e3', 'expense', 'Buffet', 90000, 'confirmed', false),
    expense('e4', 'expense', 'Impressão do programa', 48000, 'paid', true),
  ],
  decisions: [{ id: 'd1', summary: 'Entrada gratuita', decidedAt: '2026-11-03T15:00:00Z' }],
  suggestions: [
    {
      id: 's1',
      type: 'decision',
      payload: { type: 'decision', summary: 'Abertura às 19h' },
      confidence: 0.7,
      createdAt: '2026-11-06T11:40:00Z',
      source: ev('Bruno Produção', '2026-11-06T11:40:00Z', 'Acho que dá pra abrir às 19h, né?'),
    },
  ],
  summaries: [],
};
const OPS = {
  generatedAt: '2026-11-06T12:00:00Z',
  whatsapp: [{ provider: 'zapi', connected: true, lastCheckedAt: '2026-11-06T11:58:00Z', lastConnectedAt: '2026-11-06T11:58:00Z', lastError: null }],
  lastInboundAt: '2026-11-06T11:40:00Z',
  inbound: { last24h: { received: 0, queued: 0, processing: 0, processed: 142, ignored: 31, failed: 1 }, oldestPendingSeconds: 0 },
  outbox: { byStatus: { pending: 0, sending: 0, failed: 0, sent: 96, dead: 1 }, sentLast24h: 18, oldestPendingSeconds: 0 },
  ai: [
    { operation: 'extract_project_events', calls: 37, failures: 0, inputTokens: 41250, outputTokens: 6120, avgLatencyMs: 1830 },
    { operation: 'interpret_command', calls: 12, failures: 1, inputTokens: 9800, outputTokens: 1410, avgLatencyMs: 1120 },
    { operation: 'transcribe', calls: 4, failures: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: 2900 },
  ],
  retention: { days: 730, lastRunAt: '2026-11-06T06:00:00Z', result: { messages: 0, files: 0 } },
};
const OPS_DOWN = {
  ...OPS,
  whatsapp: [{ provider: 'zapi', phone: '5511900000000', connected: false, lastCheckedAt: '2026-11-06T11:58:00Z', lastConnectedAt: '2026-11-06T09:10:00Z', lastError: 'sessão desconectada do celular' }],
  outbox: { byStatus: { pending: 4, sending: 0, failed: 0, sent: 96, dead: 0 }, sentLast24h: 12, oldestPendingSeconds: 2820 },
};
/** QR determinístico (quadriculado) para o golden; o real vem da Z-API. */
const QR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 25 25" shape-rendering="crispEdges"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/>${Array.from(
  { length: 441 },
  (_, i) => ((i * 7919) % 11 < 5 ? `<rect x="${i % 21}" y="${Math.floor(i / 21)}" width="1" height="1"/>` : ''),
).join('')}</svg>`;

/** "Foto do WhatsApp" determinística (a real é uma URL temporária do WhatsApp). */
const AVATAR = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#d86e4b"/><circle cx="20" cy="16" r="7" fill="#fffdf8"/><rect x="8" y="26" width="24" height="14" rx="7" fill="#fffdf8"/></svg>').toString('base64')}`;

const XPO = { id: 'g1', name: 'PROJETO - XPO' };
const LUME = { id: 'g2', name: 'PROJETO - Lume' };
const membership = (group: { id: string; name: string }, extra: Record<string, unknown> = {}) => ({ isAdmin: false, joinedAt: '2026-10-01T12:00:00Z', group, ...extra });
const CONTACTS = [
  { id: 'k1', kind: 'resident', photoUrl: AVATAR, phone: '5511987650001', name: null, whatsappName: 'João Paulo', notes: null, lastMessageAt: '2026-11-06T11:40:00Z', createdAt: '2026-09-02T12:00:00Z', member: null, groups: [membership(XPO), membership(LUME)] },
  { id: 'k2', kind: 'contact', photoUrl: null, phone: '5511987650002', name: 'Carla (iluminação)', whatsappName: 'Carla Mendes', notes: 'Freela de luz', lastMessageAt: '2026-11-05T20:10:00Z', createdAt: '2026-09-10T12:00:00Z', member: null, groups: [membership(XPO, { isAdmin: true })] },
  { id: 'k3', kind: 'contact', photoUrl: null, phone: '5511900001111', name: null, whatsappName: 'Ana Admin', notes: null, lastMessageAt: '2026-11-04T09:00:00Z', createdAt: '2026-08-20T12:00:00Z', member: { name: 'Ana Admin', role: 'owner' }, groups: [membership(XPO), membership(LUME), membership({ id: 'g3', name: 'Produção geral' })] },
  { id: 'k4', kind: 'contact', photoUrl: null, phone: '5511987650004', name: null, whatsappName: null, notes: null, lastMessageAt: null, createdAt: '2026-11-01T12:00:00Z', member: null, groups: [membership(LUME)] },
];
const CONTACT_GROUPS = [
  { ...LUME, members: 3 },
  { ...XPO, members: 3 },
  { id: 'g3', name: 'Produção geral', members: 1 },
];

const FAILED_MESSAGES = [
  {
    id: 'fm1',
    kind: 'audio',
    senderName: 'Ana Admin',
    senderPhone: '5511900000001',
    receivedAt: '2026-11-06T10:12:00Z',
    processingError: 'IA /v1/transcribe: upstream_timeout',
    conversation: { isGroup: true, group: { name: 'PROJETO - XPO' } },
  },
];
const DEAD_DELIVERIES = [
  { id: 'dd1', recipient: '551190000', text: 'A conta de Internet vence amanhã (sáb, 07/11): R$ 149,90.', attempts: 5, lastError: 'HTTP 400 número inválido', updatedAt: '2026-11-06T09:00:00Z' },
];

const CLOSING_REPORT = [
  'Projeto *Sarau de Verão* encerrado em ter, 20/10.',
  '',
  'Tarefas: 1 concluída.',
  '',
  '*Decisões*',
  '• Entrada com contribuição consciente',
  '',
  '*Pagos*',
  '• Som e luz: R$ 2.850,00',
  '',
  'Financeiro: R$ 2.850,00 pagos · orçamento estimado R$ 3.000,00',
  '',
  'Valeu, equipe! O histórico continua disponível no painel.',
].join('\n');
const PROJECT_CLOSED = {
  ...PROJECT_XPO,
  id: 'p3',
  title: 'Sarau de Verão',
  status: 'closed',
  objective: 'Sarau de poesia no quintal',
  briefing: null,
  groupName: 'PROJETO - Sarau',
  groupCheckIns: false,
  closedAt: '2026-10-20T21:00:00Z',
  pendingReview: 0,
  totals: { paidCents: 285000, committedCents: 0, proposedCents: 0 },
  estimatedBudgetCents: 300000,
  tasks: [task('t9', 'Montar o varal de poesias', 'done', 'Ana', '2026-10-18')],
  expenses: [{ ...expense('e9', 'expense', 'Som e luz', 285000, 'paid', true), paidAt: '2026-10-18T21:00:00Z' }],
  suggestions: [],
  decisions: [{ id: 'd9', summary: 'Entrada com contribuição consciente', decidedAt: '2026-09-15T15:00:00Z' }],
  summaries: [{ id: 'sum1', kind: 'closing', content: CLOSING_REPORT, generatedAt: '2026-10-20T21:00:00Z' }],
};

/** Espera as fontes antes de fotografar: evita baseline com fonte de fallback. */
async function snap(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, opts);
}

type DataMode = 'ok' | 'empty' | 'error' | 'loading';

async function mockApi(page: Page, opts: { authed?: boolean; data?: DataMode; role?: string; opsDown?: boolean } = {}) {
  const { authed = true, data = 'ok', role = 'owner', opsDown = false } = opts;
  await page.clock.setFixedTime(NOW);
  if (authed) await page.addInitScript(() => sessionStorage.setItem('coxia-token', 'test-token'));
  const empty = data === 'empty';
  await page.route('http://api.mock/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const respond = (json: unknown) => {
      if (data === 'loading') return; // nunca responde: estado de carregamento
      if (data === 'error') return route.fulfill({ status: 500, json: { message: 'erro' } });
      return route.fulfill({ json });
    };
    if (path === '/auth/me') return route.fulfill({ json: { ...SESSION, user: { ...SESSION.user, role } } });
    if (path === '/auth/login') return route.fulfill({ status: 401, json: { message: 'E-mail ou senha incorretos' } });
    if (path === '/whatsapp/connection') return route.fulfill({ json: { provider: 'zapi', connected: !opsDown, smartphoneConnected: !opsDown, error: null } });
    if (path === '/whatsapp/qr-code') {
      return route.fulfill({ json: opsDown ? { kind: 'qr', image: `data:image/svg+xml;base64,${Buffer.from(QR_SVG).toString('base64')}` } : { kind: 'connected' } });
    }
    if (path === '/whatsapp/phone-code') return route.fulfill({ json: { kind: 'code', code: 'A1B2C3D4' } });
    if (path === '/contacts/groups') return respond(empty ? [] : CONTACT_GROUPS);
    if (path === '/contacts' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const g = url.searchParams.get('groupId');
      const items = (empty ? [] : CONTACTS).filter(
        (c) =>
          (!q || `${c.name ?? ''} ${c.whatsappName ?? ''}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q) || c.phone.includes(q)) &&
          (!g || c.groups.some((m) => m.group.id === g)),
      );
      return respond({ items, total: items.length });
    }
    if (/^\/contacts\/k\d$/.test(path)) {
      const c = CONTACTS.find((x) => path.endsWith(x.id))!;
      if (method === 'GET') return respond({ ...c, groups: [...c.groups, ...(c.id === 'k2' ? [membership({ id: 'g9', name: 'Festival 2025' }, { leftAt: '2026-01-20T12:00:00Z' })] : [])] });
      return route.fulfill({ json: { ...c, ...route.request().postDataJSON() } });
    }
    if (path === '/spaces' && method === 'GET') return respond(empty ? [] : SPACES);
    if (path === '/spaces' && method === 'POST') return route.fulfill({ status: 201, json: { ...room('s9', 'Nova', 'floresta', 'porta'), ...route.request().postDataJSON() } });
    if (/^\/spaces\/s\d\/photos\/ph\d$/.test(path) && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTO_SVG });
    }
    if (/^\/spaces\/s\d$/.test(path) && method === 'PATCH') {
      return route.fulfill({ json: { ...SPACES.find((x) => path.endsWith(x.id)), ...route.request().postDataJSON(), futureOccurrences: [] } });
    }
    if (path === '/overview') {
      return respond({
        date: '2026-11-06',
        timezone: 'America/Sao_Paulo',
        todayBookings: empty ? [] : today,
        billsDueSoon: empty ? [] : [BILLS[1]],
        billsOverdue: empty ? [] : [BILLS[2]],
        monthSummary: SUMMARY,
        activeProjects: empty ? 0 : 2,
        projectsToReview: empty ? 0 : 4,
      });
    }
    if (path === '/bookings' && method === 'GET') {
      const from = new Date(url.searchParams.get('from')!);
      const to = new Date(url.searchParams.get('to')!);
      return respond(empty ? [] : BOOKINGS.filter((b) => new Date(b.startAt) >= from && new Date(b.startAt) < to));
    }
    if (path === '/bookings' && method === 'POST') {
      return route.fulfill({
        status: 409,
        json: {
          code: 'conflict',
          message: 'Conflito: já existe reserva no horário',
          details: { conflicts: [{ startAt: '2026-11-06T14:00:00-03:00', endAt: '2026-11-06T17:00:00-03:00', reason: 'overlap', with: { title: 'Reunião de produção', responsibleName: 'Ana', startAt: '2026-11-06T14:00:00-03:00', endAt: '2026-11-06T15:30:00-03:00' } }] },
        },
      });
    }
    if (path === '/bills/occurrences') return respond(empty ? [] : [...BILLS, ONE_OFF]);
    if (path === '/bills/summary') return respond(empty ? { ...SUMMARY, expectedCents: 0, paidCents: 0, total: 0, paid: 0, pending: 0, overdue: 0, variableWithoutAmount: 0 } : SUMMARY);
    if (path === '/bills') return respond(empty ? [] : RECURRING);
    if (path === '/reminders' && method === 'GET') return respond(empty ? [] : REMINDERS);
    if (path === '/reminders' && method === 'POST') return route.fulfill({ status: 201, json: reminder({ id: 'r9', ...route.request().postDataJSON() }) });
    if (path === '/reminders/automatic') return respond(empty ? [] : AUTOMATIC);
    if (/^\/reminders\/r\d\/deactivate$/.test(path)) return route.fulfill({ json: {} });
    if (path === '/organization/members') return respond(MEMBERS);
    if (path === '/expense-categories' && method === 'GET') return respond(EXPENSE_CATEGORIES);
    if (path === '/expense-categories' && method === 'POST') return route.fulfill({ status: 201, json: { id: 'ec9', sortOrder: 9, active: true, ...route.request().postDataJSON() } });
    if (/^\/expense-categories\/ec\d$/.test(path)) return route.fulfill({ json: EXPENSE_CATEGORIES[0] });
    if (path === '/organization/team' && method === 'GET') return respond(TEAM);
    if (path === '/organization/team' && method === 'POST') return route.fulfill({ status: 201, json: { id: 'mb9', role: 'admin', user: {} } });
    if (/^\/organization\/team\/mb\d$/.test(path)) return route.fulfill({ json: TEAM[0] });
    if (path === '/incomes' && method === 'GET') return respond(empty ? [] : INCOMES);
    if (path === '/incomes/summary') return respond(empty ? { ...INCOME_SUMMARY, expectedCents: 0, receivedCents: 0, total: 0, received: 0, overdue: 0 } : INCOME_SUMMARY);
    if (path === '/incomes' && method === 'POST') return route.fulfill({ status: 201, json: income({ id: 'i9', ...route.request().postDataJSON() }) });
    if (/^\/incomes\/i\d\/(receive|cancel)$/.test(path) || /^\/incomes\/i\d$/.test(path)) return route.fulfill({ json: {} });
    if (path === '/projects/p1/incomes') return respond(INCOMES.filter((i) => i.projectId === 'p1'));
    if (path === '/whatsapp/disconnect') return route.fulfill({ json: { connected: false } });
    if (/^\/bills(\/rb\d)?$/.test(path) && (method === 'POST' || method === 'PATCH')) return route.fulfill({ status: method === 'POST' ? 201 : 200, json: {} });
    if (path === '/projects') return respond(empty ? [] : PROJECTS);
    if (path === '/projects/p1' && method === 'GET') return respond(PROJECT_XPO);
    if (path === '/projects/p3' && method === 'GET') return respond(PROJECT_CLOSED);
    if (path.startsWith('/projects/p1/') && method !== 'GET') return route.fulfill({ status: 200, json: {} });
    if (path === '/ops/overview') return respond(opsDown ? OPS_DOWN : OPS);
    if (path === '/ops/messages/failed') return respond(empty ? [] : FAILED_MESSAGES);
    if (path === '/ops/deliveries/dead') return respond(empty ? [] : DEAD_DELIVERIES);
    if (path.startsWith('/ops/') && method === 'POST') return route.fulfill({ status: 202, json: { status: 'queued' } });
    return route.fulfill({ status: 404, json: { message: 'não simulado' } });
  });
}

test.describe('golden visual', () => {
  test('login', async ({ page }) => {
    await mockApi(page, { authed: false });
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { name: 'Boas-vindas à Coxia.' })).toBeVisible();
    await snap(page, 'login.png');
  });

  test('login com erro', async ({ page }) => {
    await mockApi(page, { authed: false });
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('ana@casakaju.test');
    await page.getByLabel('Senha').fill('errada');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
    await snap(page, 'login-error.png');
  });

  test('visão geral', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bom dia, Casa Kaju.' })).toBeVisible();
    await expect(page.getByText('Ensaio geral')).toBeVisible();
    await snap(page, 'home.png', { fullPage: true });
  });

  test('visão geral carregando', async ({ page }) => {
    await mockApi(page, { data: 'loading' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bom dia, Casa Kaju.' })).toBeVisible();
    await snap(page, 'home-loading.png', { fullPage: true });
  });

  test('visão geral com erro', async ({ page }) => {
    await mockApi(page, { data: 'error' });
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível carregar a visão geral.');
    await snap(page, 'home-error.png', { fullPage: true });
  });

  test('visão geral vazia', async ({ page }) => {
    await mockApi(page, { data: 'empty' });
    await page.goto('/');
    await expect(page.getByText('Nenhuma reserva hoje')).toBeVisible();
    await snap(page, 'home-empty.png', { fullPage: true });
  });

  test('agenda com reservas', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await expect(page.getByText('Teatro').first()).toBeVisible();
    await snap(page, 'agenda.png', { fullPage: true });
  });

  test('agenda: formulário com conflito', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Nova reserva' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova reserva' });
    await dialog.getByLabel('Atividade').fill('Ensaio aberto');
    await dialog.getByLabel('Buscar contato').fill('carla');
    await dialog.getByRole('button', { name: /Carla \(iluminação\)/ }).click();
    await dialog.getByRole('button', { name: 'Reservar' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('Reunião de produção (Ana)');
    await alert.scrollIntoViewIfNeeded();
    await snap(page, 'agenda-conflict.png');
  });

  test('agenda: cancelar série pede escolha', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
    // Desktop: o chip da semana abre o diálogo. Celular: botão "Cancelar" no cartão do dia.
    if (desktop) await page.getByRole('button', { name: /Teatro/ }).click();
    else await page.getByRole('listitem').filter({ hasText: 'Teatro' }).getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog', { name: 'Cancelar reserva?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Esta e as próximas' })).toBeVisible();
    await snap(page, 'agenda-cancel-series.png');
  });

  test('contas do mês', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await expect(page.getByText('Água')).toBeVisible();
    await snap(page, 'bills.png', { fullPage: true });
  });

  test('financeiro: entradas', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas?aba=entradas');
    await expect(page.getByText('Patrocínio — 2ª parcela')).toBeVisible();
    await snap(page, 'incomes.png', { fullPage: true });
  });

  test('financeiro: nova entrada', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas?aba=entradas');
    await page.getByRole('button', { name: 'Nova entrada' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova entrada' });
    await dialog.getByLabel('Projeto').selectOption({ label: 'XPO' });
    await dialog.getByLabel('Descrição').fill('Patrocínio — 3ª parcela');
    await dialog.getByLabel('Valor (R$)').fill('5.000,00');
    await snap(page, 'income-form.png');
  });

  test('contas: registrar pagamento', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('listitem').filter({ hasText: 'Internet' }).getByRole('button', { name: 'Pagar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrar pagamento — Internet' });
    await expect(dialog.getByLabel('Valor pago (R$)')).toHaveValue('149,90');
    await snap(page, 'bills-payment.png');
  });

  test('projetos', async ({ page }) => {
    await mockApi(page);
    await page.goto('/projetos');
    await expect(page.getByText('4 para revisar')).toBeVisible();
    await snap(page, 'projects.png', { fullPage: true });
  });

  test('projeto: revisão, tarefas e financeiro', async ({ page }) => {
    await mockApi(page);
    await page.goto('/projetos/p1');
    await expect(page.getByRole('heading', { name: 'Para revisar' })).toBeVisible();
    await snap(page, 'project-detail.png', { fullPage: true });
  });

  test('projeto carregando', async ({ page }) => {
    await mockApi(page, { data: 'loading' });
    await page.goto('/projetos/p1');
    await expect(page.getByLabel('Carregando projeto')).toBeVisible();
    await snap(page, 'project-loading.png');
  });

  test('projeto com erro', async ({ page }) => {
    await mockApi(page, { data: 'error' });
    await page.goto('/projetos/p1');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível carregar o projeto.');
    await snap(page, 'project-error.png');
  });

  test('projeto encerrado com relatório', async ({ page }) => {
    await mockApi(page);
    await page.goto('/projetos/p3');
    await expect(page.getByRole('heading', { name: 'Relatório de encerramento' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Encerrar projeto' })).toHaveCount(0);
    await snap(page, 'project-closed.png', { fullPage: true });
  });

  test('projeto: encerrar pede confirmação com pendências', async ({ page }) => {
    await mockApi(page);
    await page.goto('/projetos/p1');
    await page.getByRole('button', { name: 'Encerrar projeto' }).click();
    const dialog = page.getByRole('dialog', { name: 'Encerrar XPO?' });
    await expect(dialog.getByText('4 tarefas em aberto')).toBeVisible();
    await snap(page, 'project-close-dialog.png');
  });

  test('configurações com operação', async ({ page }) => {
    await mockApi(page);
    await page.goto('/configuracoes');
    await expect(page.getByRole('heading', { name: 'Operação' })).toBeVisible();
    await expect(page.getByText('Ana Admin · PROJETO - XPO')).toBeVisible();
    await snap(page, 'settings-ops.png', { fullPage: true });
  });

  test('operação: WhatsApp desconectado', async ({ page }) => {
    await mockApi(page, { opsDown: true });
    await page.goto('/configuracoes');
    const alert = page.getByRole('alert').filter({ hasText: 'WhatsApp desconectado' });
    await expect(alert).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code para conectar o WhatsApp da Coxia' })).toBeVisible();
    await snap(page, 'settings-ops-down.png', { fullPage: true });
  });

  for (const [visao, name, text] of [
    ['mes', 'agenda-month', 'Uso no período'],
    ['trimestre', 'agenda-quarter', 'Uso no período'],
    ['ano', 'agenda-year', 'Uso no período'],
  ] as const) {
    test(`agenda: visão ${visao}`, async ({ page }) => {
      await mockApi(page);
      await page.goto(`/agenda?visao=${visao}`);
      await expect(page.getByText(text).first()).toBeVisible();
      await snap(page, `${name}.png`, { fullPage: true });
    });
  }

  test('lembretes', async ({ page }) => {
    await mockApi(page);
    await page.goto('/lembretes');
    await expect(page.getByText('Pagar Energia elétrica')).toBeVisible();
    await snap(page, 'reminders.png', { fullPage: true });
  });

  test('lembretes: ligar para um contato', async ({ page }) => {
    await mockApi(page);
    await page.goto('/lembretes');
    await page.getByRole('button', { name: 'Novo lembrete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo lembrete' });
    await dialog.getByRole('radio', { name: 'Ligar' }).click();
    await dialog.getByLabel('Buscar contato').fill('carla');
    await dialog.getByRole('button', { name: /Carla \(iluminação\)/ }).click();
    await expect(dialog.getByText('Ana Admin · +55 11 90000-1111')).toBeVisible();
    await snap(page, 'reminder-form.png');
  });

  test('contas: editar valor', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('button', { name: 'Editar Energia elétrica' }).click();
    await expect(page.getByLabel('Valor (R$)')).toHaveValue('320,00');
    await expect(page.getByLabel('Multa por atraso (R$, opcional)')).toBeVisible();
    await snap(page, 'bill-form.png');
  });

  test('agenda: reserva recorrente', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Nova reserva' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova reserva' });
    await dialog.getByLabel('Atividade').fill('Aulas de dança');
    await dialog.getByRole('radio', { name: 'Sim, toda semana' }).click();
    await dialog.getByRole('button', { name: 'segunda' }).click();
    await dialog.getByRole('button', { name: 'quarta' }).click();
    await dialog.getByRole('button', { name: 'Cadastrar' }).click();
    await dialog.getByLabel('Nome do responsável').fill('Coletivo Lume');
    await dialog.getByLabel('WhatsApp do responsável').fill('11 98765-1111');
    await snap(page, 'booking-recurring.png');
  });

  test('contas: nova conta (tipo e categoria)', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('button', { name: 'Nova conta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova conta' });
    await dialog.getByLabel('Nome').fill('Aluguel do depósito');
    await expect(dialog.getByLabel('Categoria', { exact: true })).toHaveValue('ec1');
    await snap(page, 'bill-form-new.png');
  });

  test('contas: categorias', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('button', { name: 'Categorias' }).click();
    await expect(page.getByRole('dialog', { name: 'Categorias de gasto' }).getByText('Manutenção', { exact: true })).toBeVisible();
    await snap(page, 'expense-categories.png');
  });

  test('contatos', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contatos');
    await expect(page.getByText('Carla (iluminação)')).toBeVisible();
    await snap(page, 'contacts.png', { fullPage: true });
  });

  test('contatos: detalhe', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contatos');
    await page.getByRole('button', { name: /Carla \(iluminação\)/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Carla (iluminação)' });
    await expect(dialog.getByText('Festival 2025')).toBeVisible();
    await snap(page, 'contact-dialog.png');
  });

  test('salas', async ({ page }) => {
    await mockApi(page);
    await page.goto('/salas');
    await expect(page.getByRole('img', { name: 'Foto de Sala Grande' })).toBeVisible();
    await snap(page, 'rooms.png', { fullPage: true });
  });

  test('salas: cadastro', async ({ page }) => {
    await mockApi(page);
    await page.goto('/salas');
    await page.getByRole('button', { name: 'Nova sala' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova sala' });
    await dialog.getByLabel('Nome').fill('Estúdio');
    await dialog.getByRole('radio', { name: 'Ameixa' }).click();
    await dialog.getByRole('radio', { name: 'Piano' }).click();
    await snap(page, 'room-form.png');
  });

  for (const [path, heading, name] of [
    ['/projetos', 'Projetos em movimento.', 'projects'],
    ['/agenda', 'Agenda das salas.', 'agenda'],
    ['/salas', 'Salas.', 'rooms'],
    ['/contatos', 'Contatos.', 'contacts'],
    ['/contas', 'Financeiro.', 'bills'],
    ['/lembretes', 'Lembretes.', 'reminders'],
  ] as const) {
    test(`estado vazio: ${name}`, async ({ page }) => {
      await mockApi(page, { data: 'empty' });
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await snap(page, `${name}-empty.png`, { fullPage: true });
    });
  }
});

test.describe('interação acessível', () => {
  test('troca de tema por teclado persiste após recarregar', async ({ page }) => {
    await mockApi(page);
    await page.goto('/configuracoes');
    const main = page.getByRole('main');
    const dark = main.getByRole('radio', { name: 'Escuro' });
    await dark.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(main.getByRole('radio', { name: 'Escuro' })).toHaveAttribute('aria-checked', 'true');
  });

  test('diálogo fecha com Esc e devolve o foco', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    const open = page.getByRole('button', { name: 'Nova reserva' });
    await open.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('perfil leitura não vê ações de escrita', async ({ page }) => {
    await mockApi(page, { role: 'viewer' });
    await page.goto('/contas');
    await expect(page.getByText('Água')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nova conta' })).toHaveCount(0);
    await page.goto('/agenda');
    await expect(page.getByRole('button', { name: 'Nova reserva' })).toHaveCount(0);
  });

  test('aprovar sugestão envia a decisão para a API', async ({ page }) => {
    await mockApi(page);
    await page.goto('/projetos/p1');
    const item = page.getByRole('listitem').filter({ hasText: 'Ver a luz do palco' });
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/projects/p1/tasks/t4') && r.method() === 'PATCH'),
      item.getByRole('button', { name: 'Aprovar' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ status: 'open' });
    expect(req.headers()['idempotency-key']).toBeTruthy();
  });

  test('perfil leitura vê a revisão, mas sem ações', async ({ page }) => {
    await mockApi(page, { role: 'viewer' });
    await page.goto('/projetos/p1');
    await expect(page.getByText('Ver a luz do palco', { exact: true })).toBeVisible();
    for (const name of ['Aprovar', 'Validar pagamento', 'Concluir', 'Encerrar projeto', 'Marcar paga', 'Nova']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
  });

  test('cartão do projeto navega pelo teclado', async ({ page }) => {
    await mockApi(page);
    await page.goto('/projetos');
    const link = page.getByRole('link', { name: /XPO/ });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projetos\/p1$/);
    await expect(page.getByRole('heading', { name: 'XPO', level: 1 })).toBeVisible();
  });

  test('sem rolagem horizontal', async ({ page }) => {
    await mockApi(page);
    for (const path of ['/', '/projetos', '/projetos/p1', '/projetos/p3', '/agenda', '/agenda?visao=mes', '/agenda?visao=ano', '/salas', '/contatos', '/contas', '/lembretes', '/configuracoes']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('reprocessar mensagem com falha chama a API', async ({ page }) => {
    await mockApi(page);
    await page.goto('/configuracoes');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/ops/messages/fm1/retry') && r.method() === 'POST'),
      page.getByRole('button', { name: 'Reprocessar' }).click(),
    ]);
    expect(req.headers()['idempotency-key']).toBeTruthy();
  });

  test('operação só aparece para administração; "Sair" para todos', async ({ page }) => {
    await mockApi(page, { role: 'staff' });
    await page.goto('/configuracoes');
    await expect(page.getByRole('button', { name: 'Sair' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Operação' })).toHaveCount(0);
  });

  test('no celular, Configurações fica a um toque no cabeçalho', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 1024, 'só no celular');
    await mockApi(page);
    await page.goto('/agenda');
    await page.getByRole('link', { name: 'Configurações' }).click();
    await expect(page).toHaveURL(/\/configuracoes$/);
  });

  test('alvos de toque têm pelo menos 44px no celular', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 1024, 'só no celular');
    await mockApi(page);
    for (const path of ['/', '/projetos', '/projetos/p1', '/agenda', '/agenda?visao=mes', '/agenda?visao=ano', '/salas', '/contatos', '/contas', '/lembretes', '/configuracoes']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle');
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('header a, header button, main a, main button, main summary, nav a')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 43.5)
          .map(({ el, r }) => `${(el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)} (${Math.round(r.height)}px)`),
      );
      expect(small, path).toEqual([]);
    }
  });

  test('cadastrar sala envia situação, cor, ícone e horário', async ({ page }) => {
    await mockApi(page);
    await page.goto('/salas');
    await page.getByRole('button', { name: 'Nova sala' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova sala' });
    await dialog.getByLabel('Nome').fill('Estúdio');
    await dialog.getByLabel('Descrição').fill('Com piano');
    await dialog.getByRole('radio', { name: /Alugada mensal/ }).click();
    await dialog.getByRole('radio', { name: 'Ameixa' }).click();
    await dialog.getByRole('radio', { name: 'Piano' }).click();
    await dialog.getByRole('button', { name: 'sábado' }).click(); // tira o sábado
    await dialog.getByLabel('Valor (R$)').fill('1.500,00'); // alugada mensal: valor do aluguel
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/spaces') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Cadastrar sala' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({
      name: 'Estúdio',
      description: 'Com piano',
      status: 'monthly_rental',
      color: 'ameixa',
      icon: 'piano',
      hourlyRateCents: null,
      rentAmountCents: 150000,
      rentDueDay: 10,
      tenantName: null,
      availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '22:00' })),
    });
    await expect(dialog).toBeHidden();
  });

  test('só a administração cadastra e edita salas', async ({ page }) => {
    await mockApi(page, { role: 'staff' });
    await page.goto('/salas');
    await expect(page.getByRole('heading', { name: 'Sala Grande' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova sala' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Editar/ })).toHaveCount(0);
  });

  test('nova reserva só oferece salas disponíveis', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Nova reserva' }).click();
    const options = await page.getByRole('dialog').getByLabel('Sala').locator('option').allTextContents();
    expect(options).toEqual(['Sala Grande', 'Sala Média', 'Sala Pequena']);
    // Sala com preço da hora: a locação já aparece calculada (14h–17h na Sala Grande, R$ 120/h).
    await expect(page.getByRole('dialog').getByText(/Locação: 2h × R\$\s120,00 = R\$\s240,00/)).toBeVisible();
  });

  test('visão da agenda fica no endereço e navega por período', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await expect(page.getByRole('radio', { name: 'Semana' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Trimestre' }).click();
    await expect(page).toHaveURL(/visao=trimestre/);
    await expect(page.getByRole('heading', { name: /4º trimestre de 2026/ })).toBeVisible();
    await page.getByRole('button', { name: 'Próximo trimestre' }).click();
    await expect(page.getByRole('heading', { name: /1º trimestre de 2027/ })).toBeVisible();
    await page.getByRole('button', { name: 'Hoje' }).click();
    // Dia escolhido mostra as reservas e leva à semana.
    await page.getByRole('button', { name: /^12 de novembro: 4 reservas/ }).click();
    await expect(page.getByRole('heading', { name: /quinta-feira, 12 de novembro/i })).toBeVisible();
    await expect(page.getByText('Oficina de máscaras')).toBeVisible();
    await page.getByRole('button', { name: 'Ver semana' }).click();
    await expect(page).not.toHaveURL(/visao=/);
    await expect(page.getByRole('heading', { name: 'Semana de 09/11 a 15/11' })).toBeVisible();
  });

  test('WhatsApp desconectado: código de pareamento usa o número da Coxia', async ({ page }) => {
    await mockApi(page, { opsDown: true });
    await page.goto('/configuracoes');
    const field = page.getByLabel('Número do WhatsApp da Coxia');
    await expect(field).toHaveValue('5511900000000');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/whatsapp/phone-code') && r.method() === 'POST'),
      page.getByRole('button', { name: 'Gerar código' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ phone: '5511900000000' });
    await expect(page.getByText('A1B2-C3D4')).toBeVisible();
  });

  test('contatos: busca sem acento, filtro por grupo e edição do nome', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contatos');
    await page.getByLabel('Buscar por nome ou telefone').fill('joao');
    await expect(page.getByText('1 contato')).toBeVisible();
    await expect(page.getByRole('button', { name: /João Paulo/ })).toBeVisible();
    await page.getByLabel('Buscar por nome ou telefone').fill('');
    await page.getByLabel('Grupo').selectOption({ label: 'Produção geral (1)' });
    await expect(page.getByText('1 contato')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ana Admin/ })).toBeVisible();

    await page.getByRole('button', { name: /Ana Admin/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome').fill('Ana (direção)');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/contacts/k3') && r.method() === 'PATCH'),
      dialog.getByRole('button', { name: 'Salvar' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ name: 'Ana (direção)', notes: null });
  });

  test('perfil leitura não vê Contatos', async ({ page }) => {
    await mockApi(page, { role: 'viewer' });
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('link', { name: /Contatos/ })).toHaveCount(0);
  });

  test('lembrete "ligar para" envia tipo, contato, horário e quem recebe', async ({ page }) => {
    await mockApi(page);
    await page.goto('/lembretes');
    await page.getByRole('button', { name: 'Novo lembrete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo lembrete' });
    await dialog.getByRole('radio', { name: 'Ligar' }).click();
    await dialog.getByLabel('Buscar contato').fill('carla');
    await dialog.getByRole('button', { name: /Carla \(iluminação\)/ }).click();
    await dialog.getByLabel('Data').fill('2026-11-06');
    await dialog.getByLabel('Hora').fill('14:00');
    await dialog.getByLabel('Repetir').selectOption('weekdays');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/reminders') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Criar lembrete' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({
      type: 'call',
      title: null,
      message: null,
      dueAt: '2026-11-06T14:00:00-03:00',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      recipientPhones: ['5511900001111'],
      contactId: 'k2',
      personName: null,
      personPhone: null,
    });
  });

  test('conta mensal: valor obrigatório quando não é variável', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('button', { name: 'Nova conta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova conta' });
    await dialog.getByLabel('Nome').fill('Seguro');
    await dialog.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Informe o valor fixo da conta mensal.');
    await dialog.getByLabel('Valor (R$)').fill('189,90');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/bills') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Cadastrar' }).click(),
    ]);
    expect(req.postDataJSON()).toMatchObject({ name: 'Seguro', estimatedAmountCents: 18990, isVariableAmount: false });
  });

  test('desconectar o WhatsApp pede confirmação', async ({ page }) => {
    await mockApi(page);
    await page.goto('/configuracoes');
    await page.getByRole('button', { name: 'Desconectar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Desconectar o WhatsApp?' });
    await expect(dialog).toBeVisible();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/whatsapp/disconnect') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Desconectar' }).click(),
    ]);
    expect(req).toBeTruthy();
  });

  test('entrada de projeto: envia projeto, valor e data prevista; recebimento pede valor e data', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas?aba=entradas');
    await page.getByRole('button', { name: 'Nova entrada' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova entrada' });
    await dialog.getByLabel('Projeto').selectOption({ label: 'XPO' });
    await dialog.getByLabel('Descrição').fill('Patrocínio — 3ª parcela');
    await dialog.getByLabel('Valor (R$)').fill('5.000,00');
    await dialog.getByLabel('Data prevista de pagamento').fill('2026-12-15');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/incomes') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Lançar entrada' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({
      source: 'project',
      description: 'Patrocínio — 3ª parcela',
      amountCents: 500000,
      expectedOn: '2026-12-15',
      payerName: null,
      notes: null,
      projectId: 'p1',
      spaceId: null,
    });

    await page.getByRole('listitem').filter({ hasText: 'Ensaio fotográfico' }).getByRole('button', { name: 'Recebi' }).click();
    const receive = page.getByRole('dialog', { name: 'Registrar recebimento' });
    await expect(receive.getByLabel('Valor recebido (R$)')).toHaveValue('600,00');
    const [rec] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/incomes/i3/receive') && r.method() === 'POST'),
      receive.getByRole('button', { name: 'Confirmar recebimento' }).click(),
    ]);
    expect(rec.postDataJSON()).toEqual({ amountCents: 60000, receivedOn: '2026-11-06' });
  });

  test('sala alugada: valor, dia e inquilino do aluguel mensal', async ({ page }) => {
    await mockApi(page);
    await page.goto('/salas');
    await page.getByRole('button', { name: 'Editar Ateliê do Jardim' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Valor (R$)')).toHaveValue('1800,00');
    await dialog.getByLabel('Valor (R$)').fill('2.000,00');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/spaces/s4') && r.method() === 'PATCH'),
      dialog.getByRole('button', { name: 'Salvar' }).click(),
    ]);
    expect(req.postDataJSON()).toMatchObject({ status: 'monthly_rental', rentAmountCents: 200000, rentDueDay: 10, tenantName: 'Coletivo Barro' });
  });

  test('reserva recorrente: dias, horário, duração, até, responsável novo e desconto', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Nova reserva' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova reserva' });
    await dialog.getByLabel('Atividade').fill('Aulas de dança');
    await dialog.getByRole('radio', { name: 'Sim, toda semana' }).click();
    // Hoje (sex) já vem marcado; marca seg e qua.
    await dialog.getByRole('button', { name: 'segunda' }).click();
    await dialog.getByRole('button', { name: 'quarta' }).click();
    await dialog.getByLabel('Horário', { exact: true }).fill('19:00');
    await dialog.getByLabel('Duração').selectOption({ label: '1h30' });
    await dialog.getByLabel('Repetir até (opcional)').fill('2026-12-18');
    await dialog.getByRole('button', { name: 'Cadastrar' }).click();
    await dialog.getByLabel('Nome do responsável').fill('Coletivo Lume');
    await dialog.getByLabel('WhatsApp do responsável').fill('11 98765-1111');
    await dialog.getByLabel('Valor da hora (R$)').fill('100,00');
    await expect(dialog.getByText(/desconto de 17%/)).toBeVisible();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/bookings') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Reservar' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({
      spaceId: 's1',
      title: 'Aulas de dança',
      hourlyRateCents: 10000,
      notifyOneHourBefore: false,
      onConflict: 'fail',
      responsibleName: 'Coletivo Lume',
      responsiblePhone: '11 98765-1111',
      weekly: {
        startsOn: '2026-11-06',
        until: '2026-12-18',
        slots: [1, 3, 5].map((weekday) => ({ weekday, start: '19:00', end: '20:30' })),
      },
    });
  });

  test('reserva recorrente com horário diferente por dia', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Nova reserva' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova reserva' });
    await dialog.getByRole('radio', { name: 'Sim, toda semana' }).click();
    await dialog.getByRole('button', { name: 'segunda' }).click();
    await dialog.getByRole('button', { name: 'quarta' }).click();
    await dialog.getByLabel('Horário', { exact: true }).fill('19:00');
    await dialog.getByLabel('Horário diferente por dia (opcional)').check();
    await dialog.getByLabel('Horário de segunda').fill('09:00');
    await dialog.getByLabel('Duração de segunda').selectOption('60');
    await dialog.getByLabel('Duração de sexta').selectOption('180');
    await dialog.getByLabel('Buscar contato').fill('carla');
    await dialog.getByRole('button', { name: /Carla \(iluminação\)/ }).click();
    await snap(page, 'booking-per-day.png');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/bookings') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Reservar' }).click(),
    ]);
    expect(req.postDataJSON().weekly.slots).toEqual([
      { weekday: 1, start: '09:00', end: '10:00' },
      { weekday: 3, start: '19:00', end: '21:00' },
      { weekday: 5, start: '19:00', end: '22:00' },
    ]);
    expect(req.postDataJSON().contactId).toBe('k2');
  });

  test('reserva sem responsável não é enviada', async ({ page }) => {
    await mockApi(page);
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Nova reserva' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova reserva' });
    await dialog.getByRole('button', { name: 'Reservar' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Informe o responsável');
  });

  test('equipe: cadastrar admin com telefone e senha inicial', async ({ page }) => {
    await mockApi(page);
    await page.goto('/configuracoes');
    await page.getByRole('button', { name: 'Adicionar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar pessoa à equipe' });
    await dialog.getByLabel('Nome').fill('Julia');
    await dialog.getByLabel('E-mail (login)').fill('julia@casakaju.test');
    await dialog.getByLabel('WhatsApp').fill('11 98888-7777');
    await dialog.getByLabel('Senha inicial').fill('senha-inicial-1');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/organization/team') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Cadastrar' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({
      name: 'Julia',
      email: 'julia@casakaju.test',
      phone: '11 98888-7777',
      role: 'admin',
      password: 'senha-inicial-1',
      canManageProjects: true,
      receivesMorningBriefing: false,
    });
    await expect(page.getByRole('dialog', { name: 'Pessoa cadastrada' }).getByText('senha-inicial-1')).toBeVisible();
  });

  test('contatos: filtro de residentes', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contatos');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/contacts?') && r.url().includes('kind=resident')),
      page.getByLabel('Tipo').selectOption('resident'),
    ]);
    expect(req).toBeTruthy();
  });

  test('conta mensal com multa e categoria; lançamento pontual numa data', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('button', { name: 'Nova conta' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nova conta' });
    await dialog.getByLabel('Nome').fill('Aluguel do depósito');
    await dialog.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Estoque' });
    await dialog.getByLabel('Dia do vencimento').fill('8');
    await dialog.getByLabel('Valor (R$)').fill('900,00');
    await dialog.getByLabel('Multa por atraso (R$, opcional)').fill('45,00');
    let [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/bills') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Cadastrar' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({
      kind: 'monthly',
      name: 'Aluguel do depósito',
      expenseCategoryId: 'ec2',
      dueDay: 8,
      estimatedAmountCents: 90000,
      isVariableAmount: false,
      lateFeeCents: 4500,
      startsOn: '2026-11-01',
    });

    await page.getByRole('button', { name: 'Nova conta' }).click();
    dialog = page.getByRole('dialog', { name: 'Nova conta' });
    await dialog.getByRole('radio', { name: /Outros/ }).click();
    await dialog.getByLabel('Nome').fill('Conserto da porta');
    await dialog.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Manutenção' });
    await dialog.getByLabel('Data').fill('2026-11-20');
    await dialog.getByLabel('Valor variável (informado no pagamento)').check();
    [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/bills') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Cadastrar' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({
      kind: 'one_time',
      name: 'Conserto da porta',
      expenseCategoryId: 'ec3',
      dueOn: '2026-11-20',
      dueDay: 20,
      estimatedAmountCents: null,
      isVariableAmount: true,
      startsOn: '2026-11-20',
    });
  });

  test('categorias de gasto: criar com ícone e cor', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('button', { name: 'Categorias' }).click();
    await page.getByRole('button', { name: 'Nova categoria' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova categoria' });
    await dialog.getByLabel('Nome').fill('Divulgação');
    await dialog.getByRole('radio', { name: 'Rosa' }).click();
    await dialog.getByRole('radio', { name: 'Divulgação' }).click();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/expense-categories') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Salvar' }).click(),
    ]);
    expect(req.postDataJSON()).toEqual({ name: 'Divulgação', icon: 'marketing', color: 'rosa' });
  });

  test('conta atrasada com multa: pagamento sugere valor + multa', async ({ page }) => {
    await mockApi(page);
    await page.goto('/contas');
    await page.getByRole('listitem').filter({ hasText: 'Água' }).getByRole('button', { name: 'Pagar' }).click();
    // Água: R$ 90 previstos, R$ 30 pagos, multa R$ 15 → R$ 75.
    await expect(page.getByRole('dialog').getByLabel('Valor pago (R$)')).toHaveValue('75,00');
  });

  test('sem sessão redireciona para o login', async ({ page }) => {
    await mockApi(page, { authed: false });
    await page.goto('/agenda');
    await expect(page).toHaveURL(/\/entrar$/);
  });
});
