import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/input';
import { api, apiSend, canBook, type Occurrence, type Space } from '@/lib/api';
import { dayRange, formatDayTitle, formatRange, formatShortDay, local, shiftDate, todayIn, weekDays } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { BookingForm } from './booking-form';

function useIsDesktop() {
  const query = '(min-width: 1024px)';
  const [desktop, setDesktop] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

/** Agenda: lista diária no celular, semana no desktop. */
export function AgendaPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const desktop = useIsDesktop();
  const [date, setDate] = useState(() => todayIn(tz));
  const [room, setRoom] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Occurrence | null>(null);

  const days = desktop ? weekDays(date, tz) : [date];
  const range = { from: dayRange(days[0]!, tz).from, to: dayRange(days[days.length - 1]!, tz).to };

  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') });
  const bookings = useQuery({
    queryKey: ['bookings', range.from, range.to],
    queryFn: () => api<Occurrence[]>(`/bookings?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
  });

  const visible = useMemo(() => (bookings.data ?? []).filter((o) => room === 'all' || o.spaceId === room), [bookings.data, room]);
  const byDay = (d: string) => visible.filter((o) => local(o.startAt, tz).toISODate() === d);
  const step = desktop ? 7 : 1;

  return (
    <>
      <PageHeader
        eyebrow="Espaços da casa"
        title="Agenda das salas."
        description="Horários, disponibilidade e reservas sem conflitos."
        action={
          canBook(session?.user.role) && spaces.data?.length ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus aria-hidden /> Nova reserva
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label={desktop ? 'Semana anterior' : 'Dia anterior'} onClick={() => setDate(shiftDate(date, -step))}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => setDate(todayIn(tz))}>
            Hoje
          </Button>
          <Button variant="outline" size="icon" aria-label={desktop ? 'Próxima semana' : 'Próximo dia'} onClick={() => setDate(shiftDate(date, step))}>
            <ChevronRight aria-hidden />
          </Button>
          <h2 className="ml-2 font-semibold first-letter:uppercase" aria-live="polite">
            {desktop ? `Semana de ${DateTime.fromISO(days[0]!).toFormat('dd/LL')} a ${DateTime.fromISO(days[6]!).toFormat('dd/LL')}` : formatDayTitle(date)}
          </h2>
        </div>
        <div role="radiogroup" aria-label="Filtrar por sala" className="flex gap-1 overflow-x-auto rounded-md border bg-card p-1">
          {[{ id: 'all', name: 'Todas' }, ...(spaces.data ?? [])].map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={room === s.id}
              onClick={() => setRoom(s.id)}
              className={cn('min-h-9 whitespace-nowrap rounded-sm px-3 text-sm font-medium text-muted-foreground', room === s.id && 'bg-muted text-foreground')}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {bookings.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : bookings.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar a agenda.
        </p>
      ) : desktop ? (
        <div className="grid grid-cols-7 gap-2">
          {days.map((d) => (
            <section key={d} aria-label={formatDayTitle(d)} className="min-h-64 rounded-lg border bg-card p-2">
              <h3 className={cn('mb-2 px-1 text-sm font-semibold capitalize', d === todayIn(tz) && 'text-primary')}>{formatShortDay(d)}</h3>
              <div className="flex flex-col gap-1.5">
                {byDay(d).map((o) => (
                  <OccurrenceChip key={o.id} occ={o} tz={tz} onCancel={canBook(session?.user.role) ? () => setCancelling(o) : undefined} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : byDay(date).length === 0 ? (
        <EmptyState icon={CalendarDays} title="Nenhuma reserva neste dia">
          Peça pelo WhatsApp — “Reserva a sala grande na sexta das 14h às 17h” — ou use “Nova reserva”.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {byDay(date).map((o) => (
            <li key={o.id}>
              <ReservationCard occ={o} tz={tz} onCancel={canBook(session?.user.role) ? () => setCancelling(o) : undefined} />
            </li>
          ))}
        </ul>
      )}

      {/* Montagem condicional: o formulário sempre abre limpo e o Radix devolve o foco ao botão ao fechar. */}
      {formOpen && spaces.data?.length ? (
        <BookingForm open onOpenChange={setFormOpen} spaces={spaces.data} timezone={tz} defaultDate={date} />
      ) : null}
      <CancelDialog occ={cancelling} tz={tz} onClose={() => setCancelling(null)} />
    </>
  );
}

function ReservationCard({ occ, tz, onCancel }: { occ: Occurrence; tz: string; onCancel?: () => void }) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="tabular w-20 shrink-0 text-sm font-semibold">{formatRange(occ.startAt, occ.endAt, tz)}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{occ.booking.title ?? 'Reserva'}</p>
        <p className="truncate text-sm text-muted-foreground">
          {occ.space.name}
          {occ.booking.responsibleName ? ` · ${occ.booking.responsibleName}` : ''}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {occ.booking.recurrenceRule ? (
            <Badge variant="info">
              <Repeat size={12} aria-hidden /> Semanal
            </Badge>
          ) : null}
          {occ.status === 'tentative' ? <Badge variant="pending">Provisória</Badge> : null}
        </div>
      </div>
      {onCancel ? (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      ) : null}
    </Card>
  );
}

function OccurrenceChip({ occ, tz, onCancel }: { occ: Occurrence; tz: string; onCancel?: () => void }) {
  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={!onCancel}
      title={onCancel ? 'Ver opções' : undefined}
      className="rounded-md border-l-4 border-primary bg-secondary/40 px-2 py-1.5 text-left text-xs enabled:hover:bg-secondary/70"
    >
      <span className="tabular block font-semibold">{formatRange(occ.startAt, occ.endAt, tz)}</span>
      <span className="block truncate">{occ.booking.title ?? 'Reserva'}</span>
      <span className="block truncate text-muted-foreground">{occ.space.name}</span>
    </button>
  );
}

function CancelDialog({ occ, tz, onClose }: { occ: Occurrence | null; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['bookings'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    toast.success(msg);
    onClose();
  };
  const one = useMutation({
    mutationFn: (id: string) => apiSend(`/bookings/occurrences/${id}/cancel`, 'POST'),
    onSuccess: () => done('Reserva cancelada.'),
    onError: (e) => toast.error(e.message),
  });
  const series = useMutation({
    mutationFn: (o: Occurrence) => apiSend(`/bookings/${o.bookingId}/cancel-series`, 'POST', { fromDate: local(o.startAt, tz).toISODate() }),
    onSuccess: () => done('Esta e as próximas datas foram canceladas.'),
    onError: (e) => toast.error(e.message),
  });
  if (!occ) return null;
  const isSeries = !!occ.booking.recurrenceRule;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Cancelar reserva?"
      description={`${occ.space.name}, ${local(occ.startAt, tz).toFormat('dd/LL')}, ${formatRange(occ.startAt, occ.endAt, tz)}${occ.booking.title ? ` — ${occ.booking.title}` : ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Manter
          </Button>
          {isSeries ? (
            <Button variant="destructive" loading={series.isPending} onClick={() => series.mutate(occ)}>
              Esta e as próximas
            </Button>
          ) : null}
          <Button variant="destructive" loading={one.isPending} onClick={() => one.mutate(occ.id)}>
            {isSeries ? 'Só esta data' : 'Cancelar reserva'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {isSeries ? 'Esta reserva faz parte de uma série semanal. Escolha o que cancelar.' : 'O horário fica livre para novas reservas.'}
      </p>
    </Dialog>
  );
}
