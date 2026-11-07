import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemeSwitch } from '@/components/theme-switch';
import { emitSystemTheme } from '@/test-setup';
import { THEME_STORAGE_KEY, ThemeProvider } from './theme-provider';

const renderSwitch = () =>
  render(
    <ThemeProvider>
      <ThemeSwitch />
    </ThemeProvider>,
  );

describe('ThemeProvider', () => {
  it('padrão é "system" e segue o dispositivo', () => {
    emitSystemTheme(false);
    renderSwitch();
    expect(screen.getByRole('radio', { name: 'Sistema' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement).not.toHaveClass('dark');
    act(() => emitSystemTheme(true));
    expect(document.documentElement).toHaveClass('dark');
  });

  it('escolha manual é aplicada e persistida', async () => {
    emitSystemTheme(false);
    renderSwitch();
    await userEvent.click(screen.getByRole('radio', { name: 'Escuro' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await userEvent.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(document.documentElement).not.toHaveClass('dark');
    // Preferência manual ignora mudança do sistema.
    act(() => emitSystemTheme(true));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('restaura a preferência salva', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderSwitch();
    expect(screen.getByRole('radio', { name: 'Escuro' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement).toHaveClass('dark');
  });
});
