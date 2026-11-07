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

/** Espera as fontes antes de fotografar: evita baseline com fonte de fallback. */
async function snap(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, opts);
}

type DataMode = 'ok' | 'empty' | 'error' | 'loading';

async function mockApi(page: Page, opts: { authed?: boolean; data?: DataMode; role?: string } = {}) {
  const { authed = true, data = 'ok', role = 'owner' } = opts;
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
        activeProjects: 0,
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

  test('sem rolagem horizontal', async ({ page }) => {
    await mockApi(page);
    for (const path of ['/', '/projetos', '/agenda', '/contas', '/configuracoes']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('sem sessão redireciona para o login', async ({ page }) => {
    await mockApi(page, { authed: false });
    await page.goto('/agenda');
    await expect(page).toHaveURL(/\/entrar$/);
  });
});
