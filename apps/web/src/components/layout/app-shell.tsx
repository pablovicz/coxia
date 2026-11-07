import { CalendarDays, FolderKanban, House, LogOut, ReceiptText, Settings } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { ThemeSwitch } from '@/components/theme-switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

export const NAV_ITEMS = [
  { to: '/', label: 'Visão geral', short: 'Início', icon: House, mobile: true },
  { to: '/projetos', label: 'Projetos', short: 'Projetos', icon: FolderKanban, mobile: true },
  { to: '/agenda', label: 'Agenda das salas', short: 'Agenda', icon: CalendarDays, mobile: true },
  { to: '/contas', label: 'Lembretes e contas', short: 'Contas', icon: ReceiptText, mobile: true },
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
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
          <ThemeSwitch />
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Navegação"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV_ITEMS.filter((i) => i.mobile).map(({ to, short, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground',
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
