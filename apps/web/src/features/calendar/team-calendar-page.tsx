import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarClock, ChevronLeft, ChevronRight, MapPin, Plus, ReceiptText, Repeat } from 'lucide-react';
import { DateTime } from 'luxon';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/input';
import { CategoryBadge } from '@/features/finance/expense-categories';
import { REMINDER_TYPES, ReminderForm, repeatLabel } from '@/features/reminders/reminder-form';
import { AGENDA_VIEWS, type AgendaView, isAgendaView, monthGrid, monthsOf, periodOf, shiftPeriod, WEEKDAY_HEADERS } from '@/features/rooms/calendar';
import { api, apiSend, type Appointment, type CalendarBill, type CalendarReminder, canBook, type TeamCalendar } from '@/lib/api';
import { formatBRL, formatDayTitle, formatPhone, formatRange, formatShortDay, formatTime, local, todayIn } from '@/lib/format';
import { roomStyle } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { APPOINTMENT_KINDS, AppointmentForm } from './appointment-form';

/** Cada tipo tem cor própria (paleta das salas) e aparece separado no calendário. */
export const ITEM_KINDS = {
  appointment: { label: 'Compromissos', color: 'azul', Icon: CalendarClock },
  reminder: { label: 'Lembretes', color: 'mostarda', Icon: Bell },
  bill: { label: 'Contas', color: 'terracota', Icon: ReceiptText },
} as const;
type ItemKind = keyof typeof ITEM_KINDS;
type Filter = 'all' | ItemKind;

type Item =
  | { key: string; kind: 'appointment'; date: string; sort: string; time: string; title: string; done: boolean; appointment: Appointment }
  | { key: string; kind: 'reminder'; date: string; sort: string; time: string; title: string; done: boolean; reminder: CalendarReminder }
  | { key: string; kind: 'bill'; date: string; sort: string; time: string; title: string; done: boolean; bill: CalendarBill };

const PREV: Record<AgendaView, string> = { semana: 'Semana anterior', mes: 'Mês anterior', trimestre: 'Trimestre anterior', semestre: 'Semestre anterior', ano: 'Ano anterior' };
const NEXT: Record<AgendaView, string> = { semana: 'Próxima semana', mes: 'Próximo mês', trimestre: 'Próximo trimestre', semestre: 'Próximo semestre', ano: 'Próximo ano' };

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

/**
 * Calendário da equipe, separado da agenda das salas:
 * compromissos (reuniões, visitas…), lembretes gerais e as contas, que entram sozinhas.
 */
export function TeamCalendarPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const mayEdit = canBook(session?.user.role);
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const visao = params.get('visao');
  const view: AgendaView = isAgendaView(visao) ? visao : 'semana';
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [creating, setCreating] = useState<'appointment' | 'reminder' | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [open, setOpen] = useState<Item | null>(null);

  const period = periodOf(view, date);
  const inPeriod = (d: string) => d >= period.start && d < period.end;
  const focusDay = selected && inPeriod(selected) ? selected : inPeriod(today) ? today : null;
  const range = {
    from: DateTime.fromISO(period.start, { zone: tz }).toISO()!,
    to: DateTime.fromISO(period.end, { zone: tz }).toISO()!,
  };
  const calendar = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: () => api<TeamCalendar>(`/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
  });

  const items = useMemo<Item[]>(() => {
    const data = calendar.data;
    if (!data) return [];
    const me = session?.user;
    const out: Item[] = [
      ...data.appointments.map<Item>((a) => ({
        key: `a-${a.id}`,
        kind: 'appointment',
        date: local(a.startAt, tz).toISODate()!,
        sort: a.startAt,
        time: formatRange(a.startAt, a.endAt, tz),
        title: a.title,
        done: false,
        appointment: a,
      })),
      ...data.reminders.map<Item>((r) => ({
        key: `r-${r.reminderId}-${r.at}`,
        kind: 'reminder',
        date: local(r.at, tz).toISODate()!,
        sort: r.at,
        time: formatTime(r.at, tz),
        title: r.title,
        done: r.done,
        reminder: r,
      })),
      ...data.bills.map<Item>((b) => ({
        key: `b-${b.occurrenceId}`,
        kind: 'bill',
        date: b.dueDate,
        sort: `${b.dueDate}T00:00`,
        time: 'Vence',
        title: `Pagar ${b.name}`,
        done: b.status === 'paid',
        bill: b,
      })),
    ];
    return out
      .filter((i) => filter === 'all' || i.kind === filter)
      .filter((i) => {
        if (!onlyMine || !me) return true;
        if (i.kind === 'appointment') return i.appointment.allTeam || i.appointment.participants.some((p) => p.member?.user.id === me.id);
        if (i.kind === 'reminder') return !!me.phone && i.reminder.recipientPhones.includes(me.phone);
        return true;
      })
      .sort((a, b) => a.sort.localeCompare(b.sort));
  }, [calendar.data, filter, onlyMine, session?.user, tz]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of items) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    return map;
  }, [items]);
  const dayOf = (d: string) => byDay.get(d) ?? [];

  const setView = (v: AgendaView) => {
    setParams(v === 'semana' ? {} : { visao: v }, { replace: true });
    if (focusDay) setDate(focusDay);
  };
  const defaultDate = focusDay ?? (inPeriod(today) ? today : period.start);

  return (
    <>
      <PageHeader
        eyebrow="Agenda da equipe"
        title="Lembretes."
        description="Compromissos, lembretes e contas da casa, separados da agenda das salas."
        action={
          mayEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setCreating('reminder')}>
                <Bell aria-hidden /> Novo lembrete
              </Button>
              <Button onClick={() => setCreating('appointment')}>
                <Plus aria-hidden /> Novo compromisso
              </Button>
            </div>
          ) : null
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
          <div role="radiogroup" aria-label="Visão do calendário" className="grid grid-cols-5 gap-1 rounded-md border bg-card p-1 md:flex">
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
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Mostrar" className="flex flex-wrap gap-1 rounded-md border bg-card p-1">
            <button
              type="button"
              role="radio"
              aria-checked={filter === 'all'}
              onClick={() => setFilter('all')}
              className={cn('min-h-11 rounded-sm px-3 text-sm font-medium text-muted-foreground lg:min-h-9', filter === 'all' && 'bg-muted text-foreground')}
            >
              Tudo
            </button>
            {(Object.keys(ITEM_KINDS) as ItemKind[]).map((k) => {
              const { label, color, Icon } = ITEM_KINDS[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={filter === k}
                  onClick={() => setFilter(k)}
                  style={roomStyle(color)}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm font-medium text-muted-foreground lg:min-h-9',
                    filter === k && 'room-soft text-foreground',
                  )}
                >
                  <span className="room-fill size-2.5 rounded-full" aria-hidden />
                  <Icon size={16} className="room-text" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={onlyMine}
            onClick={() => setOnlyMine((v) => !v)}
            className={cn(
              'min-h-11 rounded-md border bg-card px-3 text-sm font-medium text-muted-foreground lg:min-h-11',
              onlyMine && 'border-primary bg-primary/10 text-foreground',
            )}
          >
            Só os meus
          </button>
        </div>
      </div>

      {calendar.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando calendário">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : calendar.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar o calendário.
        </p>
      ) : view === 'semana' ? (
        <WeekView start={period.start} today={today} desktop={desktop} dayOf={dayOf} onOpen={setOpen} empty={items.length === 0} />
      ) : (
        <>
          {view === 'mes' ? (
            <MonthView month={period.start} today={today} focus={focusDay} dayOf={dayOf} onPick={setSelected} />
          ) : (
            <MultiMonthView view={view} date={period.start} today={today} focus={focusDay} dayOf={dayOf} onPick={setSelected} />
          )}
          <DayPanel
            day={focusDay}
            items={focusDay ? dayOf(focusDay) : []}
            onOpen={setOpen}
            onOpenWeek={(d) => {
              setDate(d);
              setParams({}, { replace: true });
            }}
          />
        </>
      )}

      {creating === 'appointment' ? <AppointmentForm tz={tz} defaultDate={defaultDate} onClose={() => setCreating(null)} /> : null}
      {creating === 'reminder' ? <ReminderForm tz={tz} defaultDate={defaultDate} onClose={() => setCreating(null)} /> : null}
      {editing ? <AppointmentForm tz={tz} appointment={editing} onClose={() => setEditing(null)} /> : null}
      {open ? (
        <ItemDialog
          item={open}
          tz={tz}
          mayEdit={mayEdit}
          onClose={() => setOpen(null)}
          onEdit={(a) => {
            setOpen(null);
            setEditing(a);
          }}
        />
      ) : null}
    </>
  );
}

// ───────────── item ─────────────

function ItemIcon({ item, size = 14 }: { item: Item; size?: number }) {
  const Icon = item.kind === 'appointment' ? APPOINTMENT_KINDS[item.appointment.kind].Icon : item.kind === 'reminder' ? REMINDER_TYPES[item.reminder.type].Icon : ReceiptText;
  return <Icon size={size} className="room-text shrink-0" aria-hidden />;
}

function itemSubtitle(item: Item): string | null {
  if (item.kind === 'appointment') {
    const a = item.appointment;
    const who = a.allTeam ? 'Toda a equipe' : `${a.participants.length} ${a.participants.length === 1 ? 'pessoa' : 'pessoas'}`;
    return [APPOINTMENT_KINDS[a.kind].label, a.location, who].filter(Boolean).join(' · ');
  }
  if (item.kind === 'reminder') return item.reminder.person.name ?? (item.reminder.recurrenceRule ? repeatLabel(item.reminder.recurrenceRule) : null);
  const b = item.bill;
  if (b.expectedAmountCents === null) return 'valor a confirmar';
  if (b.status === 'paid') return formatBRL(b.paidAmountCents);
  // O que falta pagar (estimativa enquanto a variável não teve pagamento).
  const open = Math.max(b.expectedAmountCents - b.paidAmountCents, 0);
  return b.paidAmountCents > 0 ? `${formatBRL(open)} em aberto` : `${b.isVariableAmount ? 'cerca de ' : ''}${formatBRL(open)}`;
}

function ItemChip({ item, onOpen }: { item: Item; onOpen: (i: Item) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      style={roomStyle(ITEM_KINDS[item.kind].color)}
      className={cn('room-bar room-soft min-w-0 rounded-md px-2 py-1.5 text-left text-xs hover:brightness-95 dark:hover:brightness-110', item.done && 'opacity-60')}
    >
      <span className="tabular flex items-center gap-1 font-semibold">
        <ItemIcon item={item} size={12} />
        {item.time}
      </span>
      <span className={cn('block truncate', item.done && 'line-through')}>{item.title}</span>
    </button>
  );
}

function ItemCard({ item, onOpen }: { item: Item; onOpen: (i: Item) => void }) {
  const sub = itemSubtitle(item);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      style={roomStyle(ITEM_KINDS[item.kind].color)}
      className={cn('room-bar flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left hover:bg-muted/50', item.done && 'opacity-60')}
    >
      <span className="room-soft grid size-10 shrink-0 place-items-center rounded-full">
        <ItemIcon item={item} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="tabular block text-sm font-semibold">{item.time}</span>
        <span className={cn('block truncate font-medium', item.done && 'line-through')}>{item.title}</span>
        {sub ? <span className="block truncate text-sm text-muted-foreground">{sub}</span> : null}
      </span>
      {item.kind === 'bill' && item.bill.status === 'overdue' ? <Badge variant="late">Atrasada</Badge> : null}
      {item.done ? <Badge variant="active">{item.kind === 'bill' ? 'Paga' : 'Feito'}</Badge> : null}
    </button>
  );
}

// ───────────── visões ─────────────

function WeekView({
  start,
  today,
  desktop,
  dayOf,
  onOpen,
  empty,
}: {
  start: string;
  today: string;
  desktop: boolean;
  dayOf: (d: string) => Item[];
  onOpen: (i: Item) => void;
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
              {dayOf(d).map((i) => (
                <ItemChip key={i.key} item={i} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }
  if (empty) {
    return (
      <EmptyState icon={CalendarClock} title="Nada nesta semana">
        Marque um compromisso (reunião, visita…) ou crie um lembrete, como “Enviar o dossiê para a XPO”.
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
            <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">Nada marcado</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dayOf(d).map((i) => (
                <li key={i.key}>
                  <ItemCard item={i} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

const countLabel = (items: Item[]) => (items.length ? `${items.length} ${items.length === 1 ? 'item' : 'itens'}` : 'nada marcado');

function MonthView({ month, today, focus, dayOf, onPick }: { month: string; today: string; focus: string | null; dayOf: (d: string) => Item[]; onPick: (d: string) => void }) {
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
        {monthGrid(month).map(({ date, inMonth }) => {
          const items = inMonth ? dayOf(date) : [];
          return (
            <button
              key={date}
              type="button"
              disabled={!inMonth}
              aria-label={`${DateTime.fromISO(date).setLocale('pt-BR').toFormat("d 'de' LLLL")}: ${countLabel(items)}`}
              aria-pressed={focus === date}
              onClick={() => onPick(date)}
              className={cn(
                'flex min-h-14 min-w-0 flex-col items-stretch gap-1 border-b border-r p-1 text-left [&:nth-child(7n)]:border-r-0 lg:min-h-28 lg:p-1.5',
                !inMonth && 'bg-muted/40',
                inMonth && 'hover:bg-muted/60',
                focus === date && 'bg-primary/8 ring-2 ring-inset ring-primary',
              )}
            >
              <span className={cn('tabular grid size-6 place-items-center self-start rounded-full text-xs font-semibold', !inMonth && 'text-muted-foreground/60', date === today && 'bg-primary text-primary-foreground')}>
                {inMonth ? DateTime.fromISO(date).day : ''}
              </span>
              <span className="flex flex-wrap gap-0.5 lg:hidden" aria-hidden>
                {items.slice(0, 6).map((i) => (
                  <span key={i.key} style={roomStyle(ITEM_KINDS[i.kind].color)} className="room-fill size-1.5 rounded-full" />
                ))}
              </span>
              <span className="hidden flex-col gap-0.5 lg:flex" aria-hidden>
                {items.slice(0, 3).map((i) => (
                  <span key={i.key} style={roomStyle(ITEM_KINDS[i.kind].color)} className={cn('room-soft flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] leading-tight', i.done && 'opacity-60')}>
                    <ItemIcon item={i} size={11} />
                    {i.kind !== 'bill' ? <span className="tabular shrink-0 font-semibold">{i.time.split('–')[0]}</span> : null}
                    <span className="truncate">{i.title}</span>
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
  dayOf: (d: string) => Item[];
  onPick: (d: string) => void;
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 [&>*]:min-w-0', view === 'trimestre' ? 'md:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3', view === 'ano' && '2xl:grid-cols-4')}>
      {monthsOf(view, date).map((m) => (
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
              const kinds = [...new Set(items.map((i) => i.kind))];
              return (
                <button
                  key={d}
                  type="button"
                  aria-label={`${DateTime.fromISO(d).setLocale('pt-BR').toFormat("d 'de' LLLL")}: ${countLabel(items)}`}
                  aria-pressed={focus === d}
                  onClick={() => onPick(d)}
                  className={cn('flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md text-xs hover:bg-muted lg:min-h-10', items.length > 0 && 'font-semibold', focus === d && 'bg-primary/10 ring-2 ring-primary')}
                >
                  <span className={cn('tabular grid size-6 place-items-center rounded-full', d === today && 'bg-primary text-primary-foreground')}>{DateTime.fromISO(d).day}</span>
                  <span className="flex h-1.5 gap-0.5" aria-hidden>
                    {kinds.map((k) => (
                      <span key={k} style={roomStyle(ITEM_KINDS[k].color)} className="room-fill size-1.5 rounded-full" />
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

function DayPanel({ day, items, onOpen, onOpenWeek }: { day: string | null; items: Item[]; onOpen: (i: Item) => void; onOpenWeek: (d: string) => void }) {
  if (!day) return <p className="mt-6 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Escolha um dia para ver o que está marcado.</p>;
  return (
    <section aria-labelledby="team-day-title" className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="team-day-title" className="font-semibold first-letter:uppercase">
          {formatDayTitle(day)}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => onOpenWeek(day)}>
          Ver semana
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">Nada marcado neste dia.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.key}>
              <ItemCard item={i} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────────── detalhe ─────────────

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function PhoneLink({ phone }: { phone: string | null }) {
  if (!phone) return null;
  return (
    <a className="tabular -my-3 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline" href={`tel:+${phone}`}>
      {formatPhone(phone)}
    </a>
  );
}

function ItemDialog({ item, tz, mayEdit, onClose, onEdit }: { item: Item; tz: string; mayEdit: boolean; onClose: () => void; onEdit: (a: Appointment) => void }) {
  const qc = useQueryClient();
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['calendar'] });
    qc.invalidateQueries({ queryKey: ['reminders'] });
    toast.success(msg);
    onClose();
  };
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = useMutation({
    mutationFn: (id: string) => apiSend(`/appointments/${id}/cancel`, 'POST'),
    onSuccess: () => done('Compromisso cancelado.'),
    onError: (e) => toast.error(e.message),
  });
  const finish = useMutation({
    mutationFn: (id: string) => apiSend(`/reminders/${id}/deactivate`, 'POST'),
    onSuccess: (_d, _v) => done(item.kind === 'reminder' && item.reminder.recurrenceRule ? 'Lembrete encerrado: não repete mais.' : 'Lembrete concluído.'),
    onError: (e) => toast.error(e.message),
  });
  const when = `${formatDayTitle(item.date)} · ${item.time}`;

  if (item.kind === 'appointment') {
    const a = item.appointment;
    const team = a.participants.filter((p) => p.member);
    const contacts = a.participants.filter((p) => p.contact);
    const guests = a.participants.filter((p) => !p.member && !p.contact);
    return (
      <Dialog
        open
        onOpenChange={(v) => !v && onClose()}
        title={a.title}
        description={`${APPOINTMENT_KINDS[a.kind].label} · ${when}`}
        footer={
          mayEdit ? (
            confirmCancel ? (
              <>
                <Button variant="outline" onClick={() => setConfirmCancel(false)}>
                  Manter
                </Button>
                <Button variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate(a.id)}>
                  Cancelar compromisso
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={() => setConfirmCancel(true)}>
                  Cancelar compromisso
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Fechar
                </Button>
                <Button onClick={() => onEdit(a)}>Editar</Button>
              </>
            )
          ) : (
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          )
        }
      >
        {confirmCancel ? <p className="mb-3 text-sm font-medium">Cancelar este compromisso? Ele sai do calendário e ninguém recebe o aviso.</p> : null}
        <dl className="divide-y">
          {a.location ? (
            <Row label="Local">
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} aria-hidden /> {a.location}
              </span>
            </Row>
          ) : null}
          <Row label="Equipe">{a.allTeam ? 'Toda a equipe' : team.map((p) => p.member!.user.name).join(', ') || '—'}</Row>
          {contacts.length ? (
            <Row label="Contatos">
              <ul>
                {contacts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2">
                    {p.contact!.name ?? p.contact!.whatsappName ?? formatPhone(p.contact!.phone)} <PhoneLink phone={p.contact!.phone || null} />
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
          {guests.length ? (
            <Row label="De fora">
              <ul>
                {guests.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2">
                    {p.name} <PhoneLink phone={p.phone} />
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
          <Row label="Aviso">{a.notifyMinutesBefore === null ? 'Sem aviso' : `${noticeLabel(a.notifyMinutesBefore)} antes, pelo WhatsApp`}</Row>
          {a.notes ? <Row label="Observações">{a.notes}</Row> : null}
        </dl>
      </Dialog>
    );
  }

  if (item.kind === 'reminder') {
    const r = item.reminder;
    const repeat = repeatLabel(r.recurrenceRule);
    return (
      <Dialog
        open
        onOpenChange={(v) => !v && onClose()}
        title={r.title}
        description={`${REMINDER_TYPES[r.type].label} · ${when}`}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            {mayEdit && r.active ? (
              <Button loading={finish.isPending} onClick={() => finish.mutate(r.reminderId)}>
                {r.recurrenceRule ? 'Encerrar (não repetir mais)' : 'Concluir'}
              </Button>
            ) : null}
          </>
        }
      >
        <dl className="divide-y">
          {repeat ? (
            <Row label="Repete">
              <span className="inline-flex items-center gap-1.5">
                <Repeat size={14} aria-hidden /> {repeat}
              </span>
            </Row>
          ) : null}
          {r.type !== 'general' && (r.person.name || r.person.phone) ? (
            <Row label={r.type === 'call' ? 'Ligar para' : 'Mensagem para'}>
              <span className="flex flex-wrap items-center gap-x-2">
                {r.person.name} <PhoneLink phone={r.person.phone} />
              </span>
            </Row>
          ) : null}
          {r.message ? <Row label="Observação">{r.message}</Row> : null}
          <Row label="Situação">{r.done ? 'Já avisado' : 'Aviso pelo WhatsApp no horário'}</Row>
        </dl>
      </Dialog>
    );
  }

  const b = item.bill;
  const open = b.expectedAmountCents === null ? null : Math.max(b.expectedAmountCents - b.paidAmountCents, 0);
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Pagar ${b.name}`}
      description={`Conta · vence ${formatDayTitle(b.dueDate)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button asChild>
            <Link to="/contas">Abrir no Financeiro</Link>
          </Button>
        </>
      }
    >
      <dl className="divide-y">
        <Row label="Valor">
          {open === null ? 'A confirmar' : `${b.isVariableAmount && b.paidAmountCents === 0 ? 'cerca de ' : ''}${formatBRL(open)}`}
          {b.lateFeeCents && b.status === 'overdue' ? ` + multa ${formatBRL(b.lateFeeCents)}` : ''}
        </Row>
        <Row label="Situação">
          {b.status === 'paid' ? (
            <Badge variant="active">Paga</Badge>
          ) : b.status === 'overdue' ? (
            <Badge variant="late">Atrasada</Badge>
          ) : b.status === 'partially_paid' ? (
            <Badge variant="pending">Parcial</Badge>
          ) : (
            <Badge variant="pending">A vencer</Badge>
          )}
        </Row>
        {b.category ? (
          <Row label="Categoria">
            <CategoryBadge category={b.category} />
          </Row>
        ) : null}
        <Row label="Avisos">Automáticos: na véspera e no dia do vencimento, até ser paga.</Row>
      </dl>
    </Dialog>
  );
}

function noticeLabel(min: number): string {
  if (min === 0) return 'Na hora';
  if (min % 1440 === 0) return `${min / 1440} dia${min > 1440 ? 's' : ''}`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min} min`;
}

