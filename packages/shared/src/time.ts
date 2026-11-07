import { DateTime } from 'luxon';

/**
 * Regras de tempo do domínio.
 * - O banco guarda instantes em UTC; datas "de calendário" (vencimento, competência) são YYYY-MM-DD
 *   interpretadas no fuso da organização.
 * - Toda conversão local → UTC passa por aqui, para que horário de verão e meses curtos
 *   tenham uma única implementação testada.
 */

export type IsoDate = string; // YYYY-MM-DD

function assertZone(dt: DateTime, timezone: string): void {
  if (!dt.isValid) {
    throw new RangeError(`Data/fuso inválido (${timezone}): ${dt.invalidExplanation ?? dt.invalidReason}`);
  }
}

/** Competência mensal no formato YYYY-MM. */
export function competenceKey(year: number, month: number): string {
  if (month < 1 || month > 12) throw new RangeError(`mês inválido: ${month}`);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Data de vencimento de uma competência.
 * Regra explícita: dia de vencimento maior que o último dia do mês vence no último dia
 * (ex.: dia 31 em fevereiro → 28/29; dia 31 em abril → 30).
 */
export function dueDateForCompetence(year: number, month: number, dueDay: number): IsoDate {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new RangeError(`dia de vencimento inválido: ${dueDay}`);
  }
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: 'UTC' });
  assertZone(first, 'UTC');
  const day = Math.min(dueDay, first.daysInMonth!);
  return first.set({ day }).toISODate()!;
}

/** Soma (ou subtrai) dias de calendário a uma data YYYY-MM-DD. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const dt = DateTime.fromISO(date, { zone: 'UTC' });
  assertZone(dt, 'UTC');
  return dt.plus({ days }).toISODate()!;
}

/** Converte data + hora local (HH:mm) no fuso informado para um instante UTC. */
export function zonedToUtc(date: IsoDate, time: string, timezone: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  assertZone(dt, timezone);
  return dt.toUTC().toJSDate();
}

/** Data de calendário (YYYY-MM-DD) de um instante, no fuso informado. */
export function localDateOf(instant: Date, timezone: string): IsoDate {
  const dt = DateTime.fromJSDate(instant, { zone: timezone });
  assertZone(dt, timezone);
  return dt.toISODate()!;
}

/** Intervalo [início, fim) em UTC do dia local informado. */
export function localDayBoundsUtc(date: IsoDate, timezone: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  assertZone(start, timezone);
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() };
}

/** Intervalos semiabertos [aStart, aEnd) e [bStart, bEnd) se sobrepõem? */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function assertValidInterval(start: Date, end: Date): void {
  if (!(start.getTime() < end.getTime())) {
    throw new RangeError('start_at deve ser anterior a end_at');
  }
}
