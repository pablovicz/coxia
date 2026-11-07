import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emite metadata de decorators, necessária para a injeção de dependência do NestJS.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
