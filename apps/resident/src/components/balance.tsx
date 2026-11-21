import { Card } from '@coxia/ui/components/ui/card';
import { formatCompetence } from '@coxia/ui/lib/format';
import { RoomIcon, roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import type { CycleBalance, Space } from '@/lib/api';
import { brDayMonth, hours } from '@/lib/api';

/** Barra do ciclo: usado (cheio), reservado (listrado) e disponível. */
function BalanceBar({ b }: { b: CycleBalance }) {
  const total = Math.max(b.grantedMinutes + b.adjustedMinutes, b.usedMinutes + b.reservedMinutes, 1);
  const pct = (m: number) => `${Math.max(0, Math.min(100, (m / total) * 100))}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="room-fill h-full" style={{ width: pct(b.usedMinutes) }} />
      <div className="room-soft h-full" style={{ width: pct(b.reservedMinutes) }} />
    </div>
  );
}

export function BalanceSummary({ b, compact }: { b: CycleBalance; compact?: boolean }) {
  const negative = b.availableMinutes < 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={cn('tabular font-semibold leading-none tracking-tight', compact ? 'text-2xl' : 'text-[40px]', negative && 'text-destructive')}>{hours(b.availableMinutes)}</p>
          <p className="mt-1 text-sm text-muted-foreground">disponíveis até {brDayMonth(b.endsOn)}</p>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          Renova em
          <br />
          <span className="tabular font-medium text-foreground">{brDayMonth(b.renewsOn)}</span>
        </p>
      </div>
      <BalanceBar b={b} />
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Do ciclo</dt>
          <dd className="tabular font-medium">
            {hours(b.grantedMinutes + b.adjustedMinutes)}
            {b.adjustedMinutes ? <span className="ml-1 text-xs text-muted-foreground">({b.adjustedMinutes > 0 ? '+' : ''}{hours(b.adjustedMinutes)} ajuste)</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Reservado</dt>
          <dd className="tabular font-medium">{hours(b.reservedMinutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Usado</dt>
          <dd className="tabular font-medium">{hours(b.usedMinutes)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function RoomTitle({ space, subtitle }: { space: Space; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3" style={roomStyle(space.color)}>
      <div className="room-soft grid size-10 shrink-0 place-items-center rounded-md">
        <RoomIcon icon={space.icon} size={20} strokeWidth={1.75} className="room-text" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold">{space.name}</p>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function CycleCard({ space, b, label, children }: { space: Space; b: CycleBalance; label?: string; children?: React.ReactNode }) {
  return (
    <Card className="p-5" style={roomStyle(space.color)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <RoomTitle space={space} subtitle={label ?? `Ciclo de ${formatCompetence(b.cycle)}`} />
      </div>
      <BalanceSummary b={b} />
      {children}
    </Card>
  );
}
