import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Button } from '@coxia/ui/components/ui/button';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, CalendarX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { OccurrenceCard } from '@/components/occurrence-card';
import { OccurrenceDialog } from '@/components/occurrence-dialog';
import { api, type Occurrence } from '@/lib/api';
import { useCheckInEnabled } from '@/providers/auth';

export function BookingsPage() {
  const checkIn = useCheckInEnabled();
  const [open, setOpen] = useState<string | null>(null);
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400_000);
  const to = new Date(now.getTime() + 75 * 86400_000);
  const list = useQuery({
    queryKey: ['bookings', 'all'],
    queryFn: () => api<Occurrence[]>(`/me/bookings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  });
  const items = list.data ?? [];
  const upcoming = items.filter((o) => new Date(o.endAt) > now);
  const past = items.filter((o) => new Date(o.endAt) <= now).reverse();

  return (
    <>
      <PageHeader
        eyebrow="Reservas"
        title="Minhas reservas"
        description={checkIn ? 'Cancele até o início para as horas voltarem. O check-in abre 15 minutos antes.' : 'Cancele até o início para as horas voltarem. No horário da reserva, as horas são debitadas do saldo.'}
        action={
          <Button asChild>
            <Link to="/agenda">
              <CalendarPlus /> Nova reserva
            </Link>
          </Button>
        }
      />
      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarX} title="Nenhuma reserva">
          Reserve um horário da sala do seu contrato.
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="futuras">
            <h2 id="futuras" className="mb-3 font-display text-xl font-semibold">
              Próximas
            </h2>
            {upcoming.length ? (
              <ul className="flex flex-col gap-3">
                {upcoming.map((o) => (
                  <OccurrenceCard
                    key={o.id}
                    o={o}
                    actions={
                      <Button variant="ghost" onClick={() => setOpen(o.id)}>
                        {o.canCancel ? 'Editar ou cancelar' : 'Detalhes'}
                      </Button>
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma reserva marcada.</p>
            )}
          </section>
          {past.length ? (
            <section aria-labelledby="passadas" className="mt-8">
              <h2 id="passadas" className="mb-3 font-display text-xl font-semibold">
                Últimos 30 dias
              </h2>
              <ul className="flex flex-col gap-3">
                {past.map((o) => (
                  <OccurrenceCard key={o.id} o={o} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      {open ? <OccurrenceDialog occurrenceId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
