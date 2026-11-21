import { ThemeSwitch } from '@coxia/ui/components/theme-switch';
import { Button } from '@coxia/ui/components/ui/button';
import { type LiveChange, useLiveEvents } from '@coxia/ui/lib/live-events';
import { cn } from '@coxia/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarPlus, House, LogOut, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { API_URL, apiSend } from '@/lib/api';
import { useAuth } from '@/providers/auth';

export const NAV = [
  { to: '/', label: 'Início', icon: House },
  { to: '/reservar', label: 'Reservar', icon: CalendarPlus },
  { to: '/reservas', label: 'Reservas', icon: CalendarCheck },
  { to: '/pagamentos', label: 'Pagamentos', icon: Wallet },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-md bg-primary font-display text-xl font-semibold text-primary-foreground" aria-hidden>
        k.
      </div>
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
  const refreshAll = () => void qc.invalidateQueries();
  useLiveEvents({
    enabled: !!me,
    baseUrl: API_URL,
    getTicket: async () => (await apiSend<{ ticket: string }>('/me/events/ticket', 'POST')).ticket,
    onReconnect: refreshAll,
    onChange: (e: LiveChange) => {
      if (e.type === 'income.changed') void qc.invalidateQueries({ queryKey: ['payments'] });
      if (e.type === 'booking.changed') {
        void qc.invalidateQueries({ queryKey: ['availability'] });
        void qc.invalidateQueries({ queryKey: ['bookings'] });
        void qc.invalidateQueries({ queryKey: ['room'] });
        void qc.invalidateQueries({ queryKey: ['occurrence'] });
      }
      if (e.type === 'booking.changed' || e.type === 'hours.changed' || e.type === 'contract.changed') {
        void qc.invalidateQueries({ queryKey: ['me'] });
        void qc.invalidateQueries({ queryKey: ['contract'] });
      }
    },
  });
}

export function Shell() {
  const { me, logout } = useAuth();
  useResidentLiveUpdates();
  return (
    <div className="min-h-dvh bg-background pb-24 lg:pb-10">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Brand />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Principal">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => cn('rounded-md px-3 py-2 text-sm font-medium', isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted')}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <ThemeSwitch className="hidden sm:flex" />
            <Button variant="ghost" size="icon" onClick={logout} aria-label={`Sair (${me?.resident.name ?? ''})`}>
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Principal">
        <div className="grid grid-cols-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn('flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium', isActive ? 'text-primary' : 'text-muted-foreground')}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
