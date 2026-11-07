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

/** Espera as fontes antes de fotografar: evita baseline com fonte de fallback. */
async function snap(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, opts);
}

type SpacesMode = 'ok' | 'empty' | 'error' | 'loading';

async function mockApi(page: Page, opts: { authed?: boolean; spaces?: SpacesMode } = {}) {
  const { authed = true, spaces = 'ok' } = opts;
  await page.clock.setFixedTime(NOW);
  if (authed) await page.addInitScript(() => sessionStorage.setItem('coxia-token', 'test-token'));
  await page.route('http://api.mock/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/me') return route.fulfill({ json: SESSION });
    if (path === '/auth/login') return route.fulfill({ status: 401, json: { message: 'E-mail ou senha incorretos' } });
    if (path === '/whatsapp/connection') return route.fulfill({ json: { provider: 'zapi', connected: true, smartphoneConnected: true, error: null } });
    if (path === '/spaces') {
      if (spaces === 'loading') return; // nunca responde: estado de carregamento
      if (spaces === 'error') return route.fulfill({ status: 500, json: { message: 'erro' } });
      return route.fulfill({ json: spaces === 'empty' ? [] : SPACES });
    }
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
    await expect(page.getByText('Sala Pequena')).toBeVisible();
    await snap(page, 'home.png', { fullPage: true });
  });

  test('visão geral carregando', async ({ page }) => {
    await mockApi(page, { spaces: 'loading' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bom dia, Casa Kaju.' })).toBeVisible();
    await snap(page, 'home-loading.png', { fullPage: true });
  });

  test('visão geral com erro', async ({ page }) => {
    await mockApi(page, { spaces: 'error' });
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível carregar as salas.');
    await snap(page, 'home-error.png', { fullPage: true });
  });

  test('visão geral sem salas', async ({ page }) => {
    await mockApi(page, { spaces: 'empty' });
    await page.goto('/');
    await expect(page.getByText('Nenhuma sala cadastrada')).toBeVisible();
    await snap(page, 'home-empty.png', { fullPage: true });
  });

  for (const [path, heading, name] of [
    ['/projetos', 'Projetos em movimento.', 'projects'],
    ['/agenda', 'Agenda das salas.', 'agenda'],
    ['/contas', 'Contas e lembretes.', 'bills'],
  ] as const) {
    test(`estado vazio: ${name}`, async ({ page }) => {
      await mockApi(page);
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
