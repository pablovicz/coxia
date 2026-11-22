import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { formatRange, local } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { Repeat } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { hours, type Occurrence } from '@/lib/api';
import { useCheckInEnabled, useTimezone } from '@/providers/auth';

export function AttendanceBadge({ o }: { o: Occurrence }) {
  const checkIn = useCheckInEnabled();
  if (o.status === 'cancelled') return <Badge variant="archived">Cancelada</Badge>;
  if (!checkIn) {
    // Sem check-in: passou do horário = realizada (horas debitadas).
    if (o.attendance === 'in_progress') return <Badge variant="pending">Agora</Badge>;
    if (o.attendance === 'checked_in' || o.attendance === 'no_show') return <Badge variant="neutral">Realizada</Badge>;
    return null;
  }
  if (o.attendance === 'checked_in') return <Badge variant="active">Check-in feito</Badge>;
  if (o.attendance === 'no_show') return <Badge variant="late">Sem check-in</Badge>;
  if (o.attendance === 'in_progress') return <Badge variant="pending">Agora</Badge>;
  return null;
}

/** Reserva: dia, horário, sala, horas e as ações (check-in quando a janela abre). */
export function OccurrenceCard({ o, actions }: { o: Occurrence; actions?: ReactNode }) {
  const tz = useTimezone();
  const start = local(o.startAt, tz);
  return (
    <li className="room-bar flex flex-col gap-3 rounded-lg border bg-card p-4 pl-5 sm:flex-row sm:items-center sm:justify-between" style={roomStyle(o.space.color)}>
      <div className="min-w-0">
        <p className="text-sm capitalize text-muted-foreground">{start.toFormat("cccc, dd 'de' LLLL")}</p>
        <p className="tabular mt-0.5 text-lg font-semibold">
          {formatRange(o.startAt, o.endAt, tz)}
          {o.label ? <span className="ml-2 font-sans text-base font-medium text-muted-foreground">{o.label}</span> : null}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{o.space.name}</span>
          <span aria-hidden>·</span>
          <span className="tabular">{hours(o.minutes)}</span>
          {o.recurring ? (
            <span className="inline-flex items-center gap-1">
              <Repeat size={14} aria-hidden /> semanal
            </span>
          ) : null}
          <AttendanceBadge o={o} />
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {o.canCheckIn ? (
          <Button asChild>
            <Link to={`/reservas/${o.id}/check-in`}>Fazer check-in</Link>
          </Button>
        ) : null}
        {actions}
      </div>
    </li>
  );
}
