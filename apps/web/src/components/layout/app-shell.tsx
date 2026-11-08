import { Bell, CalendarDays, DoorOpen, FolderKanban, House, LogOut, ReceiptText, Settings, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { ThemeSwitch } from '@/components/theme-switch';
import { Button } from '@/components/ui/button';
import { canSeeContacts } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

export const NAV_ITEMS = [
  { to: '/', label: 'Visão geral', short: 'Início', icon: House, mobile: true },
  { to: '/projetos', label: 'Projetos', short: 'Projetos', icon: FolderKanban, mobile: true },
  { to: '/agenda', label: 'Agenda das salas', short: 'Agenda', icon: CalendarDays, mobile: true },
  // No celular, Salas abre pelo botão no topo da Agenda (a barra inferior tem 4 itens).
  { to: '/salas', label: 'Salas', short: 'Salas', icon: DoorOpen, mobile: false },
  { to: '/contas', label: 'Financeiro', short: 'Finanças', icon: ReceiptText, mobile: true },
  { to: '/lembretes', label: 'Lembretes', short: 'Lembretes', icon: Bell, mobile: true },
  // Telefones são dado pessoal: perfil leitura não vê Contatos.
  { to: '/contatos', label: 'Contatos', short: 'Contatos', icon: Users, mobile: true, team: true },
  { to: '/configuracoes', label: 'Configurações', short: 'Ajustes', icon: Settings, mobile: false },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-md bg-primary font-display text-xl font-semibold text-primary-foreground">
        c.
      </div>
      <div className="leading-tight">
        <div className="font-display text-lg font-semibold">coxia</div>
        <div className="hidden text-xs text-muted-foreground sm:block">A inteligência por trás da cena.</div>
      </div>
    </div>
  );
}

/**
 * Layout mobile-first: navegação inferior abaixo de 1024px; sidebar fixa no desktop.
 */
export function AppShell() {
  const { session, logout } = useAuth();
  const items = NAV_ITEMS.filter((i) => !('team' in i) || canSeeContacts(session?.user.role));
  const mobileItems = items.filter((i) => i.mobile);
  const initials = (session?.user.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[252px_1fr]">
      <aside
        aria-label="Menu principal"
        className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-sidebar-border bg-sidebar p-5 text-sidebar-foreground lg:flex"
      >
        <Brand />
        <nav className="flex flex-col gap-1">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors hover:bg-sidebar-accent',
                  isActive && 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary',
                )
              }
            >
              <Icon size={19} strokeWidth={1.75} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-4">
          <ThemeSwitch className="self-start" />
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <div className="truncate font-semibold">{session?.user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{session?.organization.name}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair">
              <LogOut aria-hidden />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Coxia · by Casa Kaju</p>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            {/* No celular, Configurações (e "Sair") ficam fora da navegação inferior: atalho aqui. */}
            <NavLink
              to="/configuracoes"
              aria-label="Configurações"
              className={({ isActive }) =>
                cn('grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-muted', isActive && 'bg-muted text-primary')
              }
            >
              <Settings size={20} strokeWidth={1.75} aria-hidden />
            </NavLink>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Navegação"
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 grid border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden',
          mobileItems.length === 6 ? 'grid-cols-6' : mobileItems.length === 5 ? 'grid-cols-5' : 'grid-cols-4',
        )}
      >
        {mobileItems.map(({ to, short, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 font-medium text-muted-foreground',
                mobileItems.length > 5 ? 'text-[11px]' : 'text-xs',
                isActive && 'text-primary',
              )
            }
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
