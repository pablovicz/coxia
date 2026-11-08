import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, DoorOpen, Plus, Repeat } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/input';
import { api, apiSend, canBook, isBookable, type Occurrence, type Space } from '@/lib/api';
import { formatBRL, formatDayTitle, formatPhone, formatRange, formatShortDay, local, todayIn } from '@/lib/format';
import { ROOM_STATUS, RoomIcon, roomStyle } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { BookingForm } from './booking-form';
import { AGENDA_VIEWS, type AgendaView, isAgendaView, monthGrid, monthsOf, periodOf, shiftPeriod, WEEKDAY_HEADERS } from './calendar';

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

const PREV: Record<AgendaView, string> = {
  semana: 'Semana anterior',
  mes: 'Mês anterior',
  trimestre: 'Trimestre anterior',
  semestre: 'Semestre anterior',
  ano: 'Ano anterior',
};
const NEXT: Record<AgendaView, string> = {
  semana: 'Próxima semana',
  mes: 'Próximo mês',
  trimestre: 'Próximo trimestre',
  semestre: 'Próximo semestre',
  ano: 'Próximo ano',
};

/**
 * Agenda das salas: semana (padrão), mês, trimestre, semestre e ano.
 * Cada sala tem cor e ícone próprios; o filtro de salas serve de legenda.
 */
export function AgendaPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const visao = params.get('visao');
  const view: AgendaView = isAgendaView(visao) ? visao : 'semana';
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [room, setRoom] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Occurrence | null>(null);

  const period = periodOf(view, date);
  const inPeriod = (d: string) => d >= period.start && d < period.end;
  // Dia em destaque nas visões de mês para cima: o escolhido, senão hoje (se estiver no período).
  const focusDay = selected && inPeriod(selected) ? selected : inPeriod(today) ? today : null;

  const range = {
    from: DateTime.fromISO(period.start, { zone: tz }).toISO()!,
    to: DateTime.fromISO(period.end, { zone: tz }).toISO()!,
  };
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') });
  const bookings = useQuery({
    queryKey: ['bookings', range.from, range.to],
    queryFn: () => api<Occurrence[]>(`/bookings?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
  });

  const visible = useMemo(() => (bookings.data ?? []).filter((o) => room === 'all' || o.spaceId === room), [bookings.data, room]);
  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of visible) {
      const d = local(o.startAt, tz).toISODate()!;
      map.set(d, [...(map.get(d) ?? []), o]);
    }
    return map;
  }, [visible, tz]);
  const dayOf = (d: string) => byDay.get(d) ?? [];

  const bookable = (spaces.data ?? []).filter(isBookable);
  const mayBook = canBook(session?.user.role);
  const onCancel = mayBook ? (o: Occurrence) => setCancelling(o) : undefined;

  const setView = (v: AgendaView) => {
    setParams(v === 'semana' ? {} : { visao: v }, { replace: true });
    if (focusDay) setDate(focusDay);
  };
  const openWeek = (d: string) => {
    setDate(d);
    setParams({}, { replace: true });
  };

  return (
    <>
      <PageHeader
        eyebrow="Espaços da casa"
        title="Agenda das salas."
        description="Horários, disponibilidade e reservas sem conflitos."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/salas">
                <DoorOpen aria-hidden /> Salas
              </Link>
            </Button>
            {mayBook && bookable.length ? (
              <Button onClick={() => setFormOpen(true)}>
                <Plus aria-hidden /> Nova reserva
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="outline" size="icon" aria-label={PREV[view]} onClick={() => setDate(shiftPeriod(view, date, -1))}>
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDate(today);
                setSelected(today);
              }}
            >
              Hoje
            </Button>
            <Button variant="outline" size="icon" aria-label={NEXT[view]} onClick={() => setDate(shiftPeriod(view, date, 1))}>
              <ChevronRight aria-hidden />
            </Button>
            <h2 className="ml-1 min-w-0 font-semibold" aria-live="polite">
              {period.title}
            </h2>
          </div>
          <div role="radiogroup" aria-label="Visão da agenda" className="grid grid-cols-5 gap-1 rounded-md border bg-card p-1 md:flex">
            {AGENDA_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={view === v.id}
                onClick={() => setView(v.id)}
                className={cn(
                  'min-h-11 whitespace-nowrap rounded-sm px-1 text-[13px] font-medium text-muted-foreground sm:px-3 sm:text-sm lg:min-h-9',
                  view === v.id && 'bg-primary text-primary-foreground',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <RoomFilter spaces={spaces.data ?? []} value={room} onChange={setRoom} />
      </div>

      {bookings.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando agenda">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : bookings.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar a agenda.
        </p>
      ) : view === 'semana' ? (
        <WeekView start={period.start} today={today} tz={tz} desktop={desktop} dayOf={dayOf} onCancel={onCancel} empty={visible.length === 0} />
      ) : (
        <>
          {view === 'mes' ? (
            <MonthView month={period.start} today={today} focus={focusDay} tz={tz} dayOf={dayOf} onPick={setSelected} />
          ) : (
            <MultiMonthView view={view} date={period.start} today={today} focus={focusDay} dayOf={dayOf} onPick={setSelected} />
          )}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
            <DayPanel day={focusDay} tz={tz} items={focusDay ? dayOf(focusDay) : []} onCancel={onCancel} onOpenWeek={openWeek} />
            <RoomUsage spaces={(spaces.data ?? []).filter((s) => room === 'all' || s.id === room)} occurrences={visible} />
          </div>
        </>
      )}

      {/* Montagem condicional: o formulário sempre abre limpo e o Radix devolve o foco ao botão ao fechar. */}
      {formOpen && bookable.length ? (
        <BookingForm open onOpenChange={setFormOpen} spaces={bookable} timezone={tz} defaultDate={focusDay ?? (inPeriod(today) ? today : period.start)} />
      ) : null}
      <CancelDialog occ={cancelling} tz={tz} onClose={() => setCancelling(null)} />
    </>
  );
}

// ───────────── filtro / legenda ─────────────

function RoomFilter({ spaces, value, onChange }: { spaces: Space[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Filtrar por sala" className="flex flex-wrap gap-1 rounded-md border bg-card p-1">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'all'}
        onClick={() => onChange('all')}
        className={cn('min-h-11 shrink-0 whitespace-nowrap rounded-sm px-3 text-sm font-medium text-muted-foreground lg:min-h-9', value === 'all' && 'bg-muted text-foreground')}
      >
        Todas
      </button>
      {spaces.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          onClick={() => onChange(s.id)}
          style={roomStyle(s.color)}
          className={cn(
            'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-3 text-sm font-medium text-muted-foreground lg:min-h-9',
            value === s.id && 'room-soft text-foreground',
          )}
        >
          <span className="room-fill size-2.5 shrink-0 rounded-full" aria-hidden />
          <RoomIcon icon={s.icon} size={16} className="room-text" />
          {s.name}
          {s.status !== 'available' ? <span className="text-xs font-normal">({ROOM_STATUS[s.status].label.toLowerCase()})</span> : null}
        </button>
      ))}
    </div>
  );
}

// ───────────── semana ─────────────

function WeekView({
  start,
  today,
  tz,
  desktop,
  dayOf,
  onCancel,
  empty,
}: {
  start: string;
  today: string;
  tz: string;
  desktop: boolean;
  dayOf: (d: string) => Occurrence[];
  onCancel?: (o: Occurrence) => void;
  empty: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => DateTime.fromISO(start).plus({ days: i }).toISODate()!);
  if (desktop) {
    return (
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => (
          <section key={d} aria-label={formatDayTitle(d)} className="min-h-64 min-w-0 rounded-lg border bg-card p-2">
            <h3 className={cn('mb-2 px-1 text-sm font-semibold capitalize', d === today && 'text-primary')}>{formatShortDay(d)}</h3>
            <div className="flex flex-col gap-1.5">
              {dayOf(d).map((o) => (
                <OccurrenceChip key={o.id} occ={o} tz={tz} onCancel={onCancel ? () => onCancel(o) : undefined} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }
  if (empty) {
    return (
      <EmptyState icon={DoorOpen} title="Nenhuma reserva nesta semana">
        Peça pelo WhatsApp — “Reserva a sala grande na sexta das 14h às 17h” — ou use “Nova reserva”.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {days.map((d) => (
        <section key={d} aria-label={formatDayTitle(d)}>
          <h3 className={cn('mb-2 text-sm font-semibold first-letter:uppercase', d === today ? 'text-primary' : 'text-muted-foreground')}>
            {formatDayTitle(d)}
            {d === today ? ' · hoje' : ''}
          </h3>
          {dayOf(d).length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">Livre</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dayOf(d).map((o) => (
                <li key={o.id}>
                  <ReservationCard occ={o} tz={tz} onCancel={onCancel ? () => onCancel(o) : undefined} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// ───────────── mês ─────────────

function MonthView({
  month,
  today,
  focus,
  tz,
  dayOf,
  onPick,
}: {
  month: string;
  today: string;
  focus: string | null;
  tz: string;
  dayOf: (d: string) => Occurrence[];
  onPick: (d: string) => void;
}) {
  const cells = monthGrid(month);
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b text-center text-xs font-semibold text-muted-foreground" aria-hidden>
        {WEEKDAY_HEADERS.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map(({ date, inMonth }) => {
          const items = inMonth ? dayOf(date) : [];
          const label = `${DateTime.fromISO(date).setLocale('pt-BR').toFormat("d 'de' LLLL")}: ${items.length ? `${items.length} reserva${items.length > 1 ? 's' : ''}` : 'livre'}`;
          return (
            <button
              key={date}
              type="button"
              disabled={!inMonth}
              aria-label={label}
              aria-pressed={focus === date}
              onClick={() => onPick(date)}
              className={cn(
                'flex min-h-14 min-w-0 flex-col items-stretch gap-1 border-b border-r p-1 text-left [&:nth-child(7n)]:border-r-0 lg:min-h-28 lg:p-1.5',
                !inMonth && 'bg-muted/40',
                inMonth && 'hover:bg-muted/60',
                focus === date && 'bg-primary/8 ring-2 ring-inset ring-primary',
              )}
            >
              <span
                className={cn(
                  'tabular grid size-6 place-items-center self-start rounded-full text-xs font-semibold',
                  !inMonth && 'text-muted-foreground/60',
                  date === today && 'bg-primary text-primary-foreground',
                )}
              >
                {inMonth ? DateTime.fromISO(date).day : ''}
              </span>
              {/* Celular: um ponto por reserva, na cor da sala. */}
              <span className="flex flex-wrap gap-0.5 lg:hidden" aria-hidden>
                {items.slice(0, 6).map((o) => (
                  <span key={o.id} style={roomStyle(o.space.color)} className="room-fill size-1.5 rounded-full" />
                ))}
              </span>
              {/* Desktop: até 3 reservas por dia, cada uma na cor e com o ícone da sala. */}
              <span className="hidden flex-col gap-0.5 lg:flex" aria-hidden>
                {items.slice(0, 3).map((o) => (
                  <span key={o.id} style={roomStyle(o.space.color)} className="room-soft flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] leading-tight">
                    <RoomIcon icon={o.space.icon} size={11} className="room-text shrink-0" />
                    <span className="tabular shrink-0 font-semibold">{local(o.startAt, tz).toFormat('H:mm').replace(':00', 'h')}</span>
                    <span className="truncate">{o.booking.title ?? o.space.name}</span>
                  </span>
                ))}
                {items.length > 3 ? <span className="px-1 text-[11px] font-medium text-muted-foreground">+{items.length - 3} mais</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── trimestre / semestre / ano ─────────────

function MultiMonthView({
  view,
  date,
  today,
  focus,
  dayOf,
  onPick,
}: {
  view: Exclude<AgendaView, 'semana' | 'mes'>;
  date: string;
  today: string;
  focus: string | null;
  dayOf: (d: string) => Occurrence[];
  onPick: (d: string) => void;
}) {
  const months = monthsOf(view, date);
  return (
    <div className={cn('grid grid-cols-1 gap-4 [&>*]:min-w-0', view === 'trimestre' ? 'md:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3', view === 'ano' && '2xl:grid-cols-4')}>
      {months.map((m) => (
        <section key={m} aria-label={DateTime.fromISO(m).setLocale('pt-BR').toFormat("LLLL 'de' yyyy")} className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 px-1 font-semibold capitalize">{DateTime.fromISO(m).setLocale('pt-BR').toFormat('LLLL')}</h3>
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-muted-foreground" aria-hidden>
            {WEEKDAY_HEADERS.map((w) => (
              <div key={w} className="pb-1">
                {w.charAt(0)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {monthGrid(m).map(({ date: d, inMonth }) => {
              if (!inMonth) return <span key={d} aria-hidden />;
              const items = dayOf(d);
              // Um ponto por sala ocupada no dia (não por reserva): mostra quais salas, separadas pela cor.
              const rooms = [...new Map(items.map((o) => [o.spaceId, o.space])).values()];
              const label = `${DateTime.fromISO(d).setLocale('pt-BR').toFormat("d 'de' LLLL")}: ${
                items.length ? `${items.length} reserva${items.length > 1 ? 's' : ''} (${rooms.map((r) => r.name).join(', ')})` : 'livre'
              }`;
              return (
                <button
                  key={d}
                  type="button"
                  aria-label={label}
                  aria-pressed={focus === d}
                  onClick={() => onPick(d)}
                  className={cn(
                    'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md text-xs hover:bg-muted lg:min-h-10',
                    items.length > 0 && 'font-semibold',
                    focus === d && 'bg-primary/10 ring-2 ring-primary',
                  )}
                >
                  <span className={cn('tabular grid size-6 place-items-center rounded-full', d === today && 'bg-primary text-primary-foreground')}>
                    {DateTime.fromISO(d).day}
                  </span>
                  <span className="flex h-1.5 gap-0.5" aria-hidden>
                    {rooms.slice(0, 4).map((r) => (
                      <span key={r.id} style={roomStyle(r.color)} className="room-fill size-1.5 rounded-full" />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ───────────── painel do dia e uso por sala ─────────────

function DayPanel({
  day,
  tz,
  items,
  onCancel,
  onOpenWeek,
}: {
  day: string | null;
  tz: string;
  items: Occurrence[];
  onCancel?: (o: Occurrence) => void;
  onOpenWeek: (d: string) => void;
}) {
  if (!day) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Escolha um dia para ver as reservas.</p>;
  }
  return (
    <section aria-labelledby="day-panel-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="day-panel-title" className="font-semibold first-letter:uppercase">
          {formatDayTitle(day)}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => onOpenWeek(day)}>
          Ver semana
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">Nenhuma reserva neste dia.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((o) => (
            <li key={o.id}>
              <ReservationCard occ={o} tz={tz} onCancel={onCancel ? () => onCancel(o) : undefined} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const hoursFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function RoomUsage({ spaces, occurrences }: { spaces: Space[]; occurrences: Occurrence[] }) {
  if (spaces.length === 0) return null;
  return (
    <section aria-labelledby="usage-title">
      <h3 id="usage-title" className="mb-3 font-semibold">
        Uso no período
      </h3>
      <ul className="flex flex-col gap-2">
        {spaces.map((s) => {
          const mine = occurrences.filter((o) => o.spaceId === s.id);
          const hours = mine.reduce((h, o) => h + (new Date(o.endAt).getTime() - new Date(o.startAt).getTime()) / 3_600_000, 0);
          return (
            <li key={s.id} style={roomStyle(s.color)} className="room-bar flex items-center gap-3 rounded-md border bg-card px-3 py-2.5">
              <RoomIcon icon={s.icon} size={18} className="room-text shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
              <span className="tabular shrink-0 text-sm text-muted-foreground">
                {mine.length} {mine.length === 1 ? 'reserva' : 'reservas'} · {hoursFmt.format(hours)}h
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ───────────── reserva ─────────────

function ReservationCard({ occ, tz, onCancel }: { occ: Occurrence; tz: string; onCancel?: () => void }) {
  return (
    <Card style={roomStyle(occ.space.color)} className="room-bar flex items-center gap-4 p-4">
      <div className="tabular w-20 shrink-0 text-sm font-semibold">{formatRange(occ.startAt, occ.endAt, tz)}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{occ.booking.title ?? 'Reserva'}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <RoomIcon icon={occ.space.icon} size={14} className="room-text shrink-0" />
          <span className="truncate">
            {occ.space.name}
            {occ.booking.responsibleName ? ` · ${occ.booking.responsibleName}` : ''}
            {occ.booking.responsiblePhone ? ` · ${formatPhone(occ.booking.responsiblePhone)}` : ''}
          </span>
        </p>
        {occ.booking.hourlyRateCents ? (
          <p className="tabular text-sm text-muted-foreground">
            {formatBRL(Math.round(((new Date(occ.endAt).getTime() - new Date(occ.startAt).getTime()) / 3_600_000) * occ.booking.hourlyRateCents))} ·{' '}
            {formatBRL(occ.booking.hourlyRateCents)}/h
          </p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">
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
      style={roomStyle(occ.space.color)}
      className="room-bar room-soft min-w-0 rounded-md px-2 py-1.5 text-left text-xs enabled:hover:brightness-95 dark:enabled:hover:brightness-110"
    >
      <span className="tabular block font-semibold">{formatRange(occ.startAt, occ.endAt, tz)}</span>
      <span className="block truncate">{occ.booking.title ?? 'Reserva'}</span>
      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <RoomIcon icon={occ.space.icon} size={12} className="room-text shrink-0" />
        <span className="truncate">{occ.space.name}</span>
      </span>
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
    mutationFn: ({ o, wholeGroup }: { o: Occurrence; wholeGroup?: boolean }) =>
      apiSend(`/bookings/${o.bookingId}/cancel-series`, 'POST', { fromDate: local(o.startAt, tz).toISODate(), wholeGroup: !!wholeGroup }),
    onSuccess: (_d, v) => done(v.wholeGroup ? 'A reserva foi cancelada em todos os dias, desta data em diante.' : 'Esta e as próximas datas foram canceladas.'),
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
          {isSeries && occ.booking.groupId ? (
            <Button variant="destructive" loading={series.isPending && series.variables?.wholeGroup} onClick={() => series.mutate({ o: occ, wholeGroup: true })}>
              Todos os dias, daqui em diante
            </Button>
          ) : null}
          {isSeries ? (
            <Button variant="destructive" loading={series.isPending && !series.variables?.wholeGroup} onClick={() => series.mutate({ o: occ })}>
              {occ.booking.groupId ? 'Este dia da semana em diante' : 'Esta e as próximas'}
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
