import { monthGrid, WEEKDAY_HEADERS } from '@coxia/ui/calendar/calendar';
import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Button } from '@coxia/ui/components/ui/button';
import { Select } from '@coxia/ui/components/ui/field';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatDayTitle, local, shiftCompetence, todayIn } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BookingDialog } from '@/components/booking-dialog';
import { OccurrenceDialog } from '@/components/occurrence-dialog';
import { api, type Availability, brDayMonth, hours } from '@/lib/api';
import { useAuth, useTimezone } from '@/providers/auth';

type Busy = Availability['busy'][number];

/**
 * Agenda do mês da sala do contrato: o residente planeja olhando o calendário. Dia livre → modal
 * para reservar; reserva minha → modal para renomear ou cancelar. Ocupado por outra pessoa
 * aparece só como "ocupado".
 */
export function AgendaPage() {
  const { me } = useAuth();
  const tz = useTimezone();
  const [params, setParams] = useSearchParams();
  const contracts = (me?.contracts ?? []).filter((c) => c.status === 'active');
  const contract = contracts.find((c) => c.id === params.get('contrato')) ?? contracts[0];
  const today = todayIn(tz);
  const open = contract?.balance?.open ?? [];
  const firstBookable = open[0]?.bookableFrom ?? today;
  const month = params.get('mes') ?? (firstBookable > today ? firstBookable : today).slice(0, 7);
  const grid = monthGrid(`${month}-01`);
  const from = grid[0]!.date;
  const to = grid[grid.length - 1]!.date;
  const [booking, setBooking] = useState<string | null>(null);
  const [occurrence, setOccurrence] = useState<string | null>(null);

  const availability = useQuery({
    queryKey: ['availability', contract?.id, from],
    queryFn: () => api<Availability>(`/me/contracts/${contract!.id}/availability?from=${from}&to=${to}`),
    enabled: !!contract,
  });

  const busyByDay = useMemo(() => {
    const map = new Map<string, Busy[]>();
    for (const b of availability.data?.busy ?? []) {
      const d = local(b.startAt, tz).toISODate()!;
      map.set(d, [...(map.get(d) ?? []), b]);
    }
    return map;
  }, [availability.data, tz]);

  const setParam = (patch: Record<string, string>) => setParams((p) => ({ ...Object.fromEntries(p), ...patch }));
  const cycleOf = (date: string) => open.find((c) => c.bookableFrom <= date && date <= c.bookableUntil) ?? null;
  const balanceOf = (key: string) => (contract?.balance?.current.cycle === key ? contract.balance.current : contract?.balance?.next?.cycle === key ? contract.balance.next : null);

  if (!contract) {
    return (
      <>
        <PageHeader eyebrow="Agenda" title="Agenda" description="Planeje e reserve os horários da sua sala." />
        <EmptyState icon={FileText} title="Nenhum contrato ativo">
          Sem contrato de horas ativo, não há sala para reservar.
        </EmptyState>
      </>
    );
  }

  const monthTitle = DateTime.fromISO(`${month}-01`).setLocale('pt-BR').toFormat('LLLL yyyy');
  const bookingCycle = booking ? cycleOf(booking) : null;
  const bookingDay = booking ? availability.data?.days.find((d) => d.date === booking) : null;
  const current = contract.balance?.current;

  return (
    <>
      <PageHeader
        eyebrow="Agenda"
        title={contract.space.name}
        description={`Toque num dia para reservar. Agenda aberta até ${brDayMonth(open[open.length - 1]?.bookableUntil ?? today)}.`}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setParam({ mes: shiftCompetence(month, -1) })} aria-label="Mês anterior">
            <ChevronLeft />
          </Button>
          <h2 className="min-w-40 text-center font-display text-xl font-semibold capitalize" aria-live="polite">
            {monthTitle}
          </h2>
          <Button variant="ghost" size="icon" onClick={() => setParam({ mes: shiftCompetence(month, 1) })} aria-label="Próximo mês">
            <ChevronRight />
          </Button>
          {month !== today.slice(0, 7) ? (
            <Button variant="outline" size="sm" onClick={() => setParam({ mes: today.slice(0, 7) })}>
              Hoje
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {current ? (
            <span className="rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">
              <strong className="tabular">{hours(current.availableMinutes)}</strong> disponíveis no ciclo
            </span>
          ) : null}
          {contracts.length > 1 ? (
            <Select aria-label="Sala" className="w-auto min-w-48" value={contract.id} onChange={(e) => setParam({ contrato: e.target.value })}>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.space.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </div>

      {availability.isPending ? (
        <Skeleton className="h-[560px] w-full" />
      ) : (
        <div style={roomStyle(contract.space.color)}>
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAY_HEADERS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map(({ date, inMonth }) => {
              const busy = busyByDay.get(date) ?? [];
              const bookable = !!cycleOf(date) && (availability.data?.days.find((d) => d.date === date)?.free.length ?? 0) > 0;
              const isToday = date === today;
              return (
                <div
                  key={date}
                  className={cn(
                    'relative flex min-h-16 flex-col rounded-md border p-1 sm:min-h-28 sm:p-1.5',
                    !inMonth && 'opacity-45',
                    bookable ? 'bg-card' : 'bg-muted/40',
                  )}
                >
                  <button
                    type="button"
                    disabled={!bookable}
                    onClick={() => setBooking(date)}
                    aria-label={bookable ? `Reservar em ${formatDayTitle(date)}` : `${formatDayTitle(date)}: fora da agenda ou sem horário livre`}
                    className="absolute inset-0 rounded-md enabled:hover:ring-2 enabled:hover:ring-primary/40 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default"
                  />
                  <span
                    className={cn(
                      'pointer-events-none relative grid size-6 place-items-center rounded-full text-xs tabular',
                      isToday ? 'bg-primary font-semibold text-primary-foreground' : bookable ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {Number(date.slice(8))}
                  </span>
                  {/* Celular: barrinhas; a partir de 640px, o horário (e o nome das minhas). */}
                  <div className="pointer-events-none relative mt-1 flex flex-wrap gap-0.5 sm:hidden">
                    {busy.slice(0, 4).map((b) => (
                      <span key={b.startAt} className={cn('h-1.5 w-3 rounded-full', b.mine ? 'room-fill' : 'bg-muted-foreground/40')} />
                    ))}
                  </div>
                  <ul className="relative mt-1 hidden flex-col gap-0.5 sm:flex">
                    {busy.slice(0, 3).map((b) =>
                      b.mine && b.occurrenceId ? (
                        <li key={b.startAt}>
                          <button
                            type="button"
                            onClick={() => setOccurrence(b.occurrenceId)}
                            className="room-soft room-bar block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium hover:brightness-95 dark:hover:brightness-110"
                          >
                            <span className="tabular">{local(b.startAt, tz).toFormat('HH:mm')}</span> {b.label ?? 'Minha reserva'}
                          </button>
                        </li>
                      ) : (
                        <li key={b.startAt} className="pointer-events-none truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          <span className="tabular">
                            {local(b.startAt, tz).toFormat('HH:mm')}–{local(b.endAt, tz).toFormat('HH:mm')}
                          </span>{' '}
                          ocupado
                        </li>
                      ),
                    )}
                    {busy.length > 3 ? <li className="pointer-events-none text-[11px] text-muted-foreground">+{busy.length - 3}</li> : null}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="room-fill h-2 w-4 rounded-full" /> Minhas reservas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-muted-foreground/40" /> Ocupado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-muted" /> Fora da agenda aberta
            </span>
          </div>
        </div>
      )}

      {booking && bookingCycle && bookingDay ? (
        <BookingDialog contract={contract} date={booking} free={bookingDay.free} cycle={bookingCycle} balance={balanceOf(bookingCycle.key)} onClose={() => setBooking(null)} />
      ) : null}
      {occurrence ? <OccurrenceDialog occurrenceId={occurrence} onClose={() => setOccurrence(null)} /> : null}
    </>
  );
}
