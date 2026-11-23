import { useQuery } from '@tanstack/react-query';
import { CalendarDays, DoorOpen, ReceiptText } from 'lucide-react';
import type { ComponentType } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { dayRange, formatBRL, formatRange, formatTime, todayIn } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import { APPOINTMENT_KINDS } from '@/features/calendar/appointment-form';
import { REMINDER_TYPES } from '@/features/reminders/reminder-form';
import { api, type Occurrence, type TeamCalendar } from '@/lib/api';

type BadgeVariant = 'neutral' | 'active' | 'pending' | 'late' | 'archived' | 'info';

interface AgendaItem {
  key: string;
  /** Ordem: contas (o dia todo) primeiro; depois por horário. */
  sort: number;
  when: string;
  title: string;
  detail: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean; className?: string }>;
  tag: { label: string; variant: BadgeVariant };
  to: string;
  color?: string;
  muted?: boolean;
}

const BILL_TAG: Record<string, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Vence hoje', variant: 'pending' },
  partially_paid: { label: 'Parcial', variant: 'pending' },
  overdue: { label: 'Atrasada', variant: 'late' },
  paid: { label: 'Paga', variant: 'active' },
};

/**
 * Tudo o que acontece hoje: contas que vencem, reservas das salas, compromissos e lembretes.
 * Reservas vêm da visão geral; o resto, do calendário da equipe (mesma fonte da tela Calendário).
 */
export function TodayAgenda({ bookings, timezone, loadingBookings }: { bookings: Occurrence[] | undefined; timezone: string; loadingBookings: boolean }) {
  const today = todayIn(timezone);
  const range = dayRange(today, timezone);
  const calendar = useQuery({
    queryKey: ['calendar', 'today', today],
    queryFn: () => api<TeamCalendar>(`/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
    refetchInterval: 60_000,
  });

  if (loadingBookings || calendar.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  const items: AgendaItem[] = [];
  const t = (iso: string) => new Date(iso).getTime();
  for (const b of calendar.data?.bills ?? []) {
    if (b.dueDate.slice(0, 10) !== today) continue;
    const amount = b.expectedAmountCents === null ? 'valor a confirmar' : formatBRL(Math.max(b.expectedAmountCents - b.paidAmountCents, 0) || b.expectedAmountCents);
    items.push({
      key: `bill-${b.occurrenceId}`,
      sort: 0,
      when: 'Hoje',
      title: b.name,
      detail: `Conta · ${amount}${b.payeeName ? ` · para ${b.payeeName}` : ''}`,
      icon: ReceiptText,
      tag: BILL_TAG[b.status] ?? { label: 'Conta', variant: 'neutral' },
      to: `/contas/${today.slice(0, 7)}`,
      muted: b.status === 'paid',
    });
  }
  for (const o of bookings ?? []) {
    items.push({
      key: `booking-${o.id}`,
      sort: t(o.startAt),
      when: formatRange(o.startAt, o.endAt, timezone),
      title: o.booking.title ?? 'Reserva',
      detail: [o.space.name, o.booking.responsibleName].filter(Boolean).join(' · '),
      icon: DoorOpen,
      tag: { label: 'Reserva', variant: 'info' },
      to: '/agenda',
      color: o.space.color,
    });
  }
  for (const a of calendar.data?.appointments ?? []) {
    if (a.status !== 'scheduled') continue;
    const kind = APPOINTMENT_KINDS[a.kind];
    items.push({
      key: `appointment-${a.id}`,
      sort: t(a.startAt),
      when: formatRange(a.startAt, a.endAt, timezone),
      title: a.title,
      detail: [kind.label, a.location, a.project?.title].filter(Boolean).join(' · '),
      icon: kind.Icon,
      tag: { label: 'Compromisso', variant: 'neutral' },
      to: '/calendario',
    });
  }
  for (const r of calendar.data?.reminders ?? []) {
    const type = REMINDER_TYPES[r.type];
    items.push({
      key: `reminder-${r.reminderId}-${r.at}`,
      sort: t(r.at),
      when: formatTime(r.at, timezone),
      title: r.title,
      detail: [type.label, r.person.name, r.message].filter(Boolean).join(' · '),
      icon: type.Icon,
      tag: r.done ? { label: 'Feito', variant: 'archived' } : { label: 'Lembrete', variant: 'pending' },
      to: '/lembretes',
      muted: r.done,
    });
  }
  items.sort((a, b) => a.sort - b.sort);

  if (items.length === 0) {
    return (
      <EmptyState icon={CalendarDays} title="Nada para hoje">
        Sem reservas, compromissos, lembretes ou contas vencendo hoje.
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((i) => (
        <li key={i.key}>
          <Link to={i.to} className={cn('-mx-2 flex min-h-14 items-center gap-4 rounded-md px-2 py-3 hover:bg-muted', i.muted && 'opacity-60')}>
            <span className="tabular w-20 shrink-0 text-sm font-semibold">{i.when}</span>
            <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', i.color ? 'room-soft' : 'bg-muted')} style={i.color ? roomStyle(i.color) : undefined}>
              <i.icon size={18} strokeWidth={1.75} aria-hidden className={i.color ? 'room-text' : 'text-muted-foreground'} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{i.title}</span>
              <span className="block truncate text-sm text-muted-foreground">{i.detail}</span>
            </span>
            <Badge variant={i.tag.variant} className="shrink-0">
              {i.tag.label}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
