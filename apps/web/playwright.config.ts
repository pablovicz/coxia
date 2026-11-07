import { defineConfig, devices } from '@playwright/test';

/**
 * Golden tests visuais. As baselines são geradas e comparadas SEMPRE no container Linux oficial
 * do Playwright (fontes e renderização idênticas ao CI):
 *   pnpm --filter @coxia/web test:visual:docker          → compara
 *   pnpm --filter @coxia/web test:visual:docker:update   → regrava (exige revisão do diff no PR)
 */
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  // Poucos workers: screenshots estáveis importam mais que velocidade.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-390-light', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true } },
    { name: 'mobile-390-dark', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true } },
    { name: 'desktop-1440-light', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-1440-dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  ],
  webServer: {
    command: `pnpm exec vite build --mode e2e && pnpm exec vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_API_URL: 'http://api.mock' },
  },
});
