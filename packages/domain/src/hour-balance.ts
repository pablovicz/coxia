import { addDays, cycleBounds, cycleForDate, type IsoDate, localDateOf } from '@coxia/shared';

/**
 * Saldo de horas de um contrato de residente — derivado, nunca guardado.
 *
 * Regras:
 * - Cada ciclo tem o seu saldo: concessão mensal + ajustes da equipe (com sinal) daquele ciclo.
 * - As horas NÃO acumulam: o que sobra expira no fim do ciclo.
 * - Uma reserva consome horas do ciclo em que começa, desde o momento em que é feita
 *   (reservar compromete; cancelar devolve).
 * - O débito é sempre a duração total da reserva: check-in atrasado ou falta não mudam o valor.
 */

export interface BalanceGrant {
  cycle: string;
  kind: 'monthly' | 'adjustment';
  minutes: number;
  note?: string | null;
  createdAt: Date;
}

export interface BalanceOccurrence {
  id: string;
  startAt: Date;
  endAt: Date;
  status: 'confirmed' | 'tentative' | 'cancelled';
  checkedInAt: Date | null;
}

/** upcoming: ainda vai acontecer; in_progress: agora, sem check-in; checked_in; no_show: terminou sem check-in. */
export type Attendance = 'upcoming' | 'in_progress' | 'checked_in' | 'no_show';

export function attendanceOf(o: Pick<BalanceOccurrence, 'startAt' | 'endAt' | 'checkedInAt'>, now: Date): Attendance {
  if (o.checkedInAt) return 'checked_in';
  if (o.endAt <= now) return 'no_show';
  if (o.startAt <= now) return 'in_progress';
  return 'upcoming';
}

export function durationMinutes(o: { startAt: Date; endAt: Date }): number {
  return Math.round((o.endAt.getTime() - o.startAt.getTime()) / 60_000);
}

export interface CycleBalance {
  cycle: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** Dia em que o saldo renova (o que sobrar expira na véspera). */
  renewsOn: IsoDate;
  grantedMinutes: number;
  adjustedMinutes: number;
  /** Reservas que ainda não aconteceram (comprometidas). */
  reservedMinutes: number;
  /** Check-in feito ou horário já passado (falta também consome). */
  usedMinutes: number;
  availableMinutes: number;
}

export interface LedgerEntry {
  at: Date;
  kind: 'monthly' | 'adjustment' | 'booking';
  minutes: number;
  note?: string | null;
  occurrenceId?: string;
  attendance?: Attendance;
}

export interface BalanceTerms {
  cycleDay: number;
  timezone: string;
}

/** Ciclo (chave) em que a ocorrência consome horas: o do dia local em que começa. */
export function cycleKeyOfInstant(instant: Date, terms: BalanceTerms): string {
  return cycleForDate(localDateOf(instant, terms.timezone), terms.cycleDay).key;
}

export function cycleBalance(
  cycle: string,
  grants: BalanceGrant[],
  occurrences: BalanceOccurrence[],
  terms: BalanceTerms,
  now: Date,
): CycleBalance {
  const bounds = cycleBounds(cycle, terms.cycleDay);
  const mine = grants.filter((g) => g.cycle === cycle);
  const granted = mine.filter((g) => g.kind === 'monthly').reduce((s, g) => s + g.minutes, 0);
  const adjusted = mine.filter((g) => g.kind === 'adjustment').reduce((s, g) => s + g.minutes, 0);
  let reserved = 0;
  let used = 0;
  for (const o of occurrences) {
    if (o.status === 'cancelled' || cycleKeyOfInstant(o.startAt, terms) !== cycle) continue;
    const a = attendanceOf(o, now);
    if (a === 'upcoming' || a === 'in_progress') reserved += durationMinutes(o);
    else used += durationMinutes(o);
  }
  return {
    cycle,
    startsOn: bounds.startsOn,
    endsOn: bounds.endsOn,
    renewsOn: addDays(bounds.endsOn, 1),
    grantedMinutes: granted,
    adjustedMinutes: adjusted,
    reservedMinutes: reserved,
    usedMinutes: used,
    availableMinutes: granted + adjusted - reserved - used,
  };
}

/** Extrato do ciclo: concessão, ajustes e reservas (negativas), em ordem. */
export function cycleLedger(cycle: string, grants: BalanceGrant[], occurrences: BalanceOccurrence[], terms: BalanceTerms, now: Date): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    ...grants
      .filter((g) => g.cycle === cycle)
      .map((g) => ({ at: g.createdAt, kind: g.kind, minutes: g.minutes, note: g.note ?? null })),
    ...occurrences
      .filter((o) => o.status !== 'cancelled' && cycleKeyOfInstant(o.startAt, terms) === cycle)
      .map((o) => ({ at: o.startAt, kind: 'booking' as const, minutes: -durationMinutes(o), occurrenceId: o.id, attendance: attendanceOf(o, now) })),
  ];
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface AffordResult {
  ok: boolean;
  /** Ciclos que ficariam negativos com as novas reservas. */
  shortfalls: Array<{ cycle: string; neededMinutes: number; availableMinutes: number }>;
}

/** As novas reservas cabem no saldo de cada ciclo em que caem? */
export function canAfford(
  newIntervals: Array<{ start: Date; end: Date }>,
  grants: BalanceGrant[],
  occurrences: BalanceOccurrence[],
  terms: BalanceTerms,
  now: Date,
): AffordResult {
  const needed = new Map<string, number>();
  for (const i of newIntervals) {
    const key = cycleKeyOfInstant(i.start, terms);
    needed.set(key, (needed.get(key) ?? 0) + durationMinutes({ startAt: i.start, endAt: i.end }));
  }
  const shortfalls: AffordResult['shortfalls'] = [];
  for (const [cycle, minutes] of [...needed].sort(([a], [b]) => a.localeCompare(b))) {
    const available = cycleBalance(cycle, grants, occurrences, terms, now).availableMinutes;
    if (minutes > available) shortfalls.push({ cycle, neededMinutes: minutes, availableMinutes: Math.max(0, available) });
  }
  return { ok: shortfalls.length === 0, shortfalls };
}

/** "12h30" / "4h" / "30min" / "−2h". */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}min`;
  return `${sign}${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

