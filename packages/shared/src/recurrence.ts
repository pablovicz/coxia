import { DateTime } from 'luxon';
import type { IsoDate } from './time';

/**
 * Subconjunto de RRULE (RFC 5545) usado pela Coxia, sempre em datas LOCAIS da organização:
 *   FREQ=WEEKLY;INTERVAL=n;BYDAY=TU,TH[;UNTIL=YYYYMMDD][;COUNT=n]
 *   FREQ=MONTHLY;INTERVAL=n;BYMONTHDAY=31[;UNTIL=…][;COUNT=n]   (dia inexistente → último dia do mês)
 * Os horários ficam fora da regra (local_start_time/local_end_time) e são convertidos para UTC
 * data a data, o que mantém o horário local correto mesmo com mudanças de fuso/horário de verão.
 */
export interface RecurrenceRule {
  freq: 'WEEKLY' | 'MONTHLY';
  interval: number;
  /** ISO: 1 = segunda … 7 = domingo. Vazio → dia da semana da data inicial. */
  byWeekday: number[];
  /** Vazio → dia do mês da data inicial. */
  byMonthDay: number | null;
  until: IsoDate | null;
  count: number | null;
}

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

const d = (iso: IsoDate) => {
  const dt = DateTime.fromISO(iso, { zone: 'UTC' });
  if (!dt.isValid) throw new RangeError(`data inválida: ${iso}`);
  return dt;
};

export function isoWeekday(date: IsoDate): number {
  return d(date).weekday;
}

export function parseRRule(input: string): RecurrenceRule {
  const parts = new Map(
    input
      .replace(/^RRULE:/i, '')
      .split(';')
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split('=');
        if (!k || v === undefined) throw new RangeError(`RRULE malformada: ${input}`);
        return [k.toUpperCase(), v.toUpperCase()] as const;
      }),
  );
  const freq = parts.get('FREQ');
  if (freq !== 'WEEKLY' && freq !== 'MONTHLY') throw new RangeError(`FREQ não suportada: ${freq ?? '(vazia)'}`);
  for (const k of parts.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL', 'COUNT'].includes(k)) {
      throw new RangeError(`parte de RRULE não suportada: ${k}`);
    }
  }
  const interval = Number(parts.get('INTERVAL') ?? '1');
  if (!Number.isInteger(interval) || interval < 1) throw new RangeError('INTERVAL inválido');

  const byWeekday = (parts.get('BYDAY') ?? '')
    .split(',')
    .filter(Boolean)
    .map((code) => {
      const i = DAY_CODES.indexOf(code as (typeof DAY_CODES)[number]);
      if (i < 0) throw new RangeError(`BYDAY inválido: ${code}`);
      return i + 1;
    });
  const byMonthDayRaw = parts.get('BYMONTHDAY');
  const byMonthDay = byMonthDayRaw === undefined ? null : Number(byMonthDayRaw);
  if (byMonthDay !== null && (!Number.isInteger(byMonthDay) || byMonthDay < 1 || byMonthDay > 31)) {
    throw new RangeError('BYMONTHDAY inválido');
  }
  const untilRaw = parts.get('UNTIL');
  const until = untilRaw ? normalizeUntil(untilRaw) : null;
  const countRaw = parts.get('COUNT');
  const count = countRaw === undefined ? null : Number(countRaw);
  if (count !== null && (!Number.isInteger(count) || count < 1)) throw new RangeError('COUNT inválido');

  return { freq, interval, byWeekday: [...new Set(byWeekday)].sort(), byMonthDay, until, count };
}

function normalizeUntil(v: string): IsoDate {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
  if (!m) throw new RangeError(`UNTIL inválido: ${v}`);
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  d(iso);
  return iso;
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byWeekday.length) parts.push(`BYDAY=${rule.byWeekday.map((w) => DAY_CODES[w - 1]).join(',')}`);
  if (rule.byMonthDay !== null) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  return parts.join(';');
}

/**
 * Datas (locais) em que a regra ocorre, a partir de `start` (inclusive), limitadas a [from, to].
 * COUNT é contado desde `start`, não desde `from`.
 */
export function expandDates(rule: RecurrenceRule, start: IsoDate, from: IsoDate, to: IsoDate): IsoDate[] {
  const startDt = d(start);
  let end = d(to);
  if (rule.until && d(rule.until) < end) end = d(rule.until);
  const fromDt = d(from);
  const out: IsoDate[] = [];
  let emitted = 0;

  const weekdays = rule.byWeekday.length ? rule.byWeekday : [startDt.weekday];
  const monthDay = rule.byMonthDay ?? startDt.day;
  const startWeek = startDt.startOf('week');

  for (let cur = startDt; cur <= end; cur = cur.plus({ days: 1 })) {
    let match = false;
    if (rule.freq === 'WEEKLY') {
      const weeks = Math.round(cur.startOf('week').diff(startWeek, 'weeks').weeks);
      match = weeks % rule.interval === 0 && weekdays.includes(cur.weekday);
    } else {
      const months = (cur.year - startDt.year) * 12 + (cur.month - startDt.month);
      match = months % rule.interval === 0 && cur.day === Math.min(monthDay, cur.daysInMonth!);
    }
    if (!match) continue;
    emitted++;
    if (rule.count !== null && emitted > rule.count) break;
    if (cur >= fromDt) out.push(cur.toISODate()!);
  }
  return out;
}
