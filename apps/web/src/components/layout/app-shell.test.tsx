import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider } from '@coxia/ui/providers/theme-provider';
import { AppShell } from './app-shell';

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="*" element={<p>conteúdo</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  it('navegação inferior (sem sessão: sem Contatos) tem alvo de toque ≥ 44px', () => {
    renderAt('/');
    const bottom = screen.getByRole('navigation', { name: 'Navegação' });
    const links = within(bottom).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Início', 'Calendário', 'Reservas', 'Projetos', 'Finanças']);
    for (const l of links) expect(l.className).toContain('min-h-16');
  });

  it('marca a rota atual como ativa', () => {
    renderAt('/agenda');
    const bottom = screen.getByRole('navigation', { name: 'Navegação' });
    expect(within(bottom).getByRole('link', { name: 'Reservas' })).toHaveAttribute('aria-current', 'page');
    expect(within(bottom).getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current');
  });

  it('sidebar inclui Configurações', () => {
    renderAt('/');
    const side = screen.getByRole('complementary', { name: 'Menu principal' });
    expect(within(side).getByRole('link', { name: 'Configurações' })).toBeInTheDocument();
  });
});
