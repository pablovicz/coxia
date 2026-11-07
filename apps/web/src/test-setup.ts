import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = '';
});

// jsdom não implementa matchMedia; cada teste pode sobrescrever `prefersDark`.
const listeners = new Set<(e: MediaQueryListEvent) => void>();
(globalThis as { prefersDark?: boolean }).prefersDark = false;
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    get matches() {
      return query.includes('dark') && (globalThis as { prefersDark?: boolean }).prefersDark === true;
    },
    media: query,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatch: (matches: boolean) => listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent)),
  })),
});

export function emitSystemTheme(dark: boolean) {
  (globalThis as { prefersDark?: boolean }).prefersDark = dark;
  listeners.forEach((cb) => cb({ matches: dark } as MediaQueryListEvent));
}
