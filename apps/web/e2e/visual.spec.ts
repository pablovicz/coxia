import { expect, type Page, test } from '@playwright/test';

/**
 * Golden visual + interação. A API é simulada (http://api.mock) para resultados determinísticos;
 * o relógio é fixado em sexta, 06/11/2026, 09:00 em São Paulo.
 */
const NOW = new Date('2026-11-06T12:00:00Z');

const SESSION = {
  user: { id: 'u1', name: 'Ana Admin', email: 'ana@casakaju.test', role: 'owner' },
  organization: { id: 'o1', name: 'Casa Kaju', timezone: 'America/Sao_Paulo' },
};
const rules = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '22:00' }));
const SPACES = [
  { id: 's1', name: 'Sala Grande', slug: 'sala-grande', aliases: [], capacity: null, availabilityRules: rules },
  { id: 's2', name: 'Sala Média', slug: 'sala-media', aliases: [], capacity: null, availabilityRules: rules },
  { id: 's3', name: 'Sala Pequena', slug: 'sala-pequena', aliases: [], capacity: null, availabilityRules: rules },
];

const occ = (id: string, space: number, day: string, start: string, end: string, title: string | null, who: string | null, weekly = false) => ({
  id,
  bookingId: `b-${id}`,
  spaceId: SPACES[space]!.id,
  startAt: `2026-11-${day}T${start}:00-03:00`,
  endAt: `2026-11-${day}T${end}:00-03:00`,
  status: 'confirmed',
  isException: false,
  booking: { id: `b-${id}`, title, responsibleName: who, responsiblePhone: null, notes: null, recurrenceRule: weekly ? 'FREQ=WEEKLY;BYDAY=TU' : null },
  space: { id: SPACES[space]!.id, name: SPACES[space]!.name },
});

const BOOKINGS = [
  occ('o1', 0, '02', '09:00', '11:00', 'Ensaio', 'Micaela'),
  occ('o2', 1, '03', '14:00', '17:00', 'Oficina de cerâmica', 'Bruno'),
  occ('o3', 2, '03', '19:00', '21:00', 'Dança', null, true),
  occ('o4', 0, '06', '09:00', '12:00', 'Ensaio geral', 'Micaela'),
  occ('o5', 2, '06', '14:00', '15:30', 'Reunião de produção', 'Ana'),
  occ('o6', 1, '06', '19:00', '21:30', 'Teatro', 'Coletivo Lume', true),
  occ('o7', 2, '07', '10:00', '13:00', 'Ateliê', null),
];
const today = BOOKINGS.filter((b) => b.startAt.startsWith('2026-11-06'));

const bill = (id: string, name: string, due: string, expected: number | null, paid: number, status: string) => ({
  id,
  competence: '2026-11',
  dueDate: `2026-11-${due}T00:00:00.000Z`,
  expectedAmountCents: expected,
  paidAmountCents: paid,
  status,
  paidAt: null,
  recurringBill: { id: `rb-${id}`, name, category: 'outros', isVariableAmount: expected === null },
  payments: [],
});
const BILLS = [
  bill('c1', 'Aluguel', '05', 250000, 250000, 'paid'),
  bill('c2', 'Energia elétrica', '07', null, 0, 'pending'),
  bill('c3', 'Água', '04', 9000, 3000, 'overdue'),
  bill('c4', 'Internet', '20', 14990, 0, 'pending'),
  bill('c5', 'Telefone', '30', 9900, 0, 'pending'),
];
const SUMMARY = { competence: '2026-11', expectedCents: 283890, paidCents: 253000, total: 5, paid: 1, pending: 3, overdue: 1, variableWithoutAmount: 1 };
const RECURRING = [
  { id: 'rb1', name: 'Aluguel', category: 'aluguel', dueDay: 5, estimatedAmountCents: 250000, isVariableAmount: false, active: true, suspendedAt: null, recipientPhones: [] },
  { id: 'rb2', name: 'Energia elétrica', category: 'energia', dueDay: 7, estimatedAmountCents: null, isVariableAmount: true, active: true, suspendedAt: null, recipientPhones: [] },
  { id: 'rb3', name: 'Gás', category: 'outros', dueDay: 31, estimatedAmountCents: 5000, isVariableAmount: false, active: false, suspendedAt: '2026-10-01T00:00:00Z', recipientPhones: [] },
];
const REMINDERS = [
  { id: 'r1', title: 'Renovar alvará', message: null, kind: 'one_time', recurrenceRule: null, nextRunAt: '2026-11-10T12:00:00Z', active: true, recipientPhones: ['5511'] },
  { id: 'r2', title: 'Regar as plantas', message: null, kind: 'recurring', recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR', nextRunAt: '2026-11-13T10:00:00Z', active: true, recipientPhones: ['5511'] },
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
  whatsapp: [{ provider: 'zapi', connected: false, lastCheckedAt: '2026-11-06T11:58:00Z', lastConnectedAt: '2026-11-06T09:10:00Z', lastError: 'sessão desconectada do celular' }],
  outbox: { byStatus: { pending: 4, sending: 0, failed: 0, sent: 96, dead: 0 }, sentLast24h: 12, oldestPendingSeconds: 2820 },
};
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
    if (path === '/whatsapp/connection') return route.fulfill({ json: { provider: 'zapi', connected: true, smartphoneConnected: true, error: null } });
    if (path === '/spaces') return route.fulfill({ json: SPACES });
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
    if (path === '/bills/occurrences') return respond(empty ? [] : BILLS);
    if (path === '/bills/summary') return respond(empty ? { ...SUMMARY, expectedCents: 0, paidCents: 0, total: 0, paid: 0, pending: 0, overdue: 0, variableWithoutAmount: 0 } : SUMMARY);
    if (path === '/bills') return respond(empty ? [] : RECURRING);
    if (path === '/reminders') return respond(empty ? [] : REMINDERS);
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
    await snap(page, 'settings-ops-down.png', { fullPage: true });
  });

  for (const [path, heading, name] of [
    ['/projetos', 'Projetos em movimento.', 'projects'],
    ['/agenda', 'Agenda das salas.', 'agenda'],
    ['/contas', 'Contas e lembretes.', 'bills'],
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
    for (const path of ['/', '/projetos', '/projetos/p1', '/projetos/p3', '/agenda', '/contas', '/configuracoes']) {
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
    for (const path of ['/', '/projetos', '/projetos/p1', '/agenda', '/contas', '/configuracoes']) {
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

  test('sem sessão redireciona para o login', async ({ page }) => {
    await mockApi(page, { authed: false });
    await page.goto('/agenda');
    await expect(page).toHaveURL(/\/entrar$/);
  });
});
