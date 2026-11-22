import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatRange, local } from '@coxia/ui/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CalendarX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { OccurrenceCard } from '@/components/occurrence-card';
import { ApiBodyError, api, apiSend, hours, type Occurrence } from '@/lib/api';
import { useCheckInEnabled, useTimezone } from '@/providers/auth';

function CancelDialog({ o, onClose }: { o: Occurrence; onClose: () => void }) {
  const tz = useTimezone();
  const qc = useQueryClient();
  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries();
    onClose();
  };
  const fail = (err: unknown) => toast.error(err instanceof ApiBodyError ? err.message : 'Não foi possível cancelar.');
  const one = useMutation({ mutationFn: () => apiSend(`/me/bookings/occurrences/${o.id}/cancel`, 'POST'), onSuccess: () => done(`Reserva cancelada. ${hours(o.minutes)} voltaram para o saldo.`), onError: fail });
  const series = useMutation({
    mutationFn: () => apiSend<{ cancelled: number }>(`/me/bookings/${o.bookingId}/cancel-series`, 'POST', { fromDate: local(o.startAt, tz).toISODate() }),
    onSuccess: (r) => done(`${r.cancelled} reserva(s) cancelada(s). As horas voltaram para o saldo.`),
    onError: fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Cancelar reserva?"
      description={`${local(o.startAt, tz).toFormat("cccc, dd/MM")} · ${formatRange(o.startAt, o.endAt, tz)} · ${o.space.name}`}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Manter
          </Button>
          {o.recurring ? (
            <Button variant="outline" loading={series.isPending} onClick={() => series.mutate()}>
              Esta e as próximas
            </Button>
          ) : null}
          <Button variant="destructive" loading={one.isPending} onClick={() => one.mutate()}>
            {o.recurring ? 'Só esta' : 'Cancelar reserva'}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">As horas voltam para o saldo do ciclo e o convite some do seu calendário.</p>
    </Dialog>
  );
}

export function BookingsPage() {
  const checkIn = useCheckInEnabled();
  const [cancelling, setCancelling] = useState<Occurrence | null>(null);
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
            <Link to="/reservar">
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
                      o.canCancel ? (
                        <Button variant="ghost" onClick={() => setCancelling(o)}>
                          Cancelar
                        </Button>
                      ) : null
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
      {cancelling ? <CancelDialog o={cancelling} onClose={() => setCancelling(null)} /> : null}
    </>
  );
}
