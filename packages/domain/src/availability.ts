import { localDateOf, localDayBoundsUtc, type IsoDate, zonedToUtc } from '@coxia/shared';
import { DateTime } from 'luxon';

export interface OpeningRule {
  /** ISO: 1 = segunda … 7 = domingo */
  weekday: number;
  opensAt: string; // HH:mm local
  closesAt: string; // HH:mm local
}

export interface Interval {
  start: Date;
  end: Date;
}

const hhmm = (instant: Date, timezone: string) => DateTime.fromJSDate(instant, { zone: timezone }).toFormat('HH:mm');

/**
 * O intervalo cabe no horário de funcionamento do dia (local)?
 * Sem regras cadastradas, a sala é considerada sempre disponível.
 * Reservas não podem cruzar a meia-noite.
 */
export function withinOperatingHours(rules: OpeningRule[], start: Date, end: Date, timezone: string): boolean {
  if (rules.length === 0) return true;
  const day = localDateOf(start, timezone);
  const endsAtMidnight = hhmm(end, timezone) === '00:00' && localDateOf(new Date(end.getTime() - 1), timezone) === day;
  if (localDateOf(end, timezone) !== day && !endsAtMidnight) return false;
  const weekday = DateTime.fromISO(day, { zone: timezone }).weekday;
  const s = hhmm(start, timezone);
  const e = endsAtMidnight ? '24:00' : hhmm(end, timezone);
  return rules.some((r) => r.weekday === weekday && r.opensAt <= s && e <= (r.closesAt === '00:00' ? '24:00' : r.closesAt));
}

/** Intervalos em que a sala funciona no dia local informado. */
export function openIntervals(rules: OpeningRule[], date: IsoDate, timezone: string): Interval[] {
  if (rules.length === 0) {
    const { start, end } = localDayBoundsUtc(date, timezone);
    return [{ start, end }];
  }
  const weekday = DateTime.fromISO(date, { zone: timezone }).weekday;
  return rules
    .filter((r) => r.weekday === weekday)
    .map((r) => ({ start: zonedToUtc(date, r.opensAt, timezone), end: zonedToUtc(date, r.closesAt, timezone) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Subtrai os intervalos ocupados dos livres. Resultado ordenado, sem fragmentos vazios. */
export function subtractIntervals(free: Interval[], busy: Interval[], minMinutes = 15): Interval[] {
  const sortedBusy = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const f of free) {
    let cursor = f.start;
    for (const b of sortedBusy) {
      if (b.end <= cursor || b.start >= f.end) continue;
      if (b.start > cursor) out.push({ start: cursor, end: b.start });
      if (b.end > cursor) cursor = b.end;
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end });
  }
  return out.filter((i) => i.end.getTime() - i.start.getTime() >= minMinutes * 60_000);
}

/** Recorta intervalos a uma janela (ex.: "amanhã à tarde"). */
export function clipIntervals(intervals: Interval[], window: Interval): Interval[] {
  return intervals
    .map((i) => ({
      start: i.start > window.start ? i.start : window.start,
      end: i.end < window.end ? i.end : window.end,
    }))
    .filter((i) => i.start < i.end);
}
