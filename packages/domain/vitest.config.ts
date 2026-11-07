import { defineConfig } from 'vitest/config';

// Unitários (puros). Integração com banco: vitest.integration.config.ts.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
