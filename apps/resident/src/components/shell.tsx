import { BrandMark } from '@coxia/ui/components/brand-mark';
import { ThemeSwitch } from '@coxia/ui/components/theme-switch';
import { Button } from '@coxia/ui/components/ui/button';
import { type LiveChange, useLiveEvents } from '@coxia/ui/lib/live-events';
import { cn } from '@coxia/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarDays, FileText, House, LogOut, Settings, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { API_URL, apiSend } from '@/lib/api';
import { useAuth } from '@/providers/auth';
import { ResidentAvatar } from './resident-avatar';

/** `mobile`: aparece na barra inferior do celular (Configurações fica no topo). */
export const NAV = [
  { to: '/', label: 'Início', icon: House, mobile: true },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, mobile: true },
  { to: '/reservas', label: 'Minhas reservas', short: 'Reservas', icon: CalendarCheck, mobile: true },
  { to: '/contratos', label: 'Contratos', icon: FileText, mobile: true },
  { to: '/pagamentos', label: 'Pagamentos', icon: Wallet, mobile: true },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, mobile: false },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <BrandMark />
      <div className="leading-tight">
        <div className="font-display text-lg font-semibold">Casa Kaju</div>
        <div className="text-xs text-muted-foreground">Workspace do residente</div>
      </div>
    </div>
  );
}

/** Tempo real: o que a equipe ou outro residente mudou aparece sem recarregar. */
function useResidentLiveUpdates() {
  const qc = useQueryClient();
  const { me } = useAuth();
  useLiveEvents({
    enabled: !!me,
    baseUrl: API_URL,
    getTicket: async () => (await apiSend<{ ticket: string }>('/me/events/ticket', 'POST')).ticket,
    onReconnect: () => void qc.invalidateQueries(),
    onChange: (e: LiveChange) => {
      if (e.type === 'income.changed') void qc.invalidateQueries({ queryKey: ['payments'] });
      if (e.type === 'booking.changed') {
        void qc.invalidateQueries({ queryKey: ['availability'] });
        void qc.invalidateQueries({ queryKey: ['bookings'] });
        void qc.invalidateQueries({ queryKey: ['room'] });
        void qc.invalidateQueries({ queryKey: ['occurrence'] });
      }
      if (e.type === 'booking.changed' || e.type === 'hours.changed' || e.type === 'contract.changed' || e.type === 'access.changed') {
        void qc.invalidateQueries({ queryKey: ['me'] });
        void qc.invalidateQueries({ queryKey: ['contract'] });
      }
    },
  });
}

export function Shell() {
  const { me, logout } = useAuth();
  useResidentLiveUpdates();
  const mobile = NAV.filter((i) => i.mobile);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[252px_1fr]">
      <aside aria-label="Menu principal" className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-sidebar-border bg-sidebar p-5 text-sidebar-foreground lg:flex">
        <Brand />
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
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
            <ResidentAvatar name={me?.resident.name} version={me?.resident.photoUpdatedAt} />
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <div className="truncate font-semibold">{me?.resident.name}</div>
              <div className="truncate text-xs text-muted-foreground">{me?.resident.loginEmail}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair">
              <LogOut aria-hidden />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <Brand />
          <NavLink
            to="/configuracoes"
            aria-label="Configurações"
            className={({ isActive }) => cn('rounded-full ring-offset-2 ring-offset-background', isActive && 'ring-2 ring-primary')}
          >
            <ResidentAvatar name={me?.resident.name} version={me?.resident.photoUpdatedAt} />
          </NavLink>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          <Outlet />
        </main>
      </div>

      <nav aria-label="Navegação" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {mobile.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => cn('flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground', isActive && 'text-primary')}
          >
            <item.icon size={20} strokeWidth={1.75} aria-hidden />
            <span className="truncate">{'short' in item ? item.short : item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
