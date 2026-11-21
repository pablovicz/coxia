import { addDays, dueDateForCompetence, type IsoDate } from './time';

/**
 * Ciclos mensais de um contrato de horas de residente.
 *
 * - O ciclo "YYYY-MM" começa no `cycleDay` daquele mês (29–31 caem no último dia em meses curtos)
 *   e termina na véspera do início do ciclo seguinte.
 * - As horas não acumulam: o saldo de cada ciclo vale só dentro dele.
 * - Dia de virada (`bookingOpensDay`): a partir dele o residente já reserva o ciclo seguinte.
 *   A abertura do ciclo C é a última data com esse dia que não passa do início de C
 *   (ex.: ciclo no dia 1º e virada no dia 25 → o ciclo de dezembro abre em 25/11).
 */

export interface ContractCycle {
  /** YYYY-MM do mês em que o ciclo começa. */
  key: string;
  /** Primeiro dia do ciclo (local). */
  startsOn: IsoDate;
  /** Último dia do ciclo (local, inclusive). */
  endsOn: IsoDate;
}

const CYCLE_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseKey(key: string): { year: number; month: number } {
  const m = CYCLE_KEY.exec(key);
  if (!m) throw new RangeError(`ciclo inválido: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

function keyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function assertDay(day: number, label: string) {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`${label} inválido: ${day}`);
}

/** Ciclo `n` meses depois (ou antes, com n negativo). */
export function shiftCycleKey(key: string, n: number): string {
  const { year, month } = parseKey(key);
  const index = year * 12 + (month - 1) + n;
  return keyOf(Math.floor(index / 12), (index % 12) + 1);
}

/** Primeiro dia do ciclo. */
export function cycleStartsOn(key: string, cycleDay: number): IsoDate {
  assertDay(cycleDay, 'dia do ciclo');
  const { year, month } = parseKey(key);
  return dueDateForCompetence(year, month, cycleDay);
}

export function cycleBounds(key: string, cycleDay: number): ContractCycle {
  const startsOn = cycleStartsOn(key, cycleDay);
  const endsOn = addDays(cycleStartsOn(shiftCycleKey(key, 1), cycleDay), -1);
  return { key, startsOn, endsOn };
}

/** Ciclo que contém a data local informada. */
export function cycleForDate(date: IsoDate, cycleDay: number): ContractCycle {
  const key = date.slice(0, 7);
  parseKey(key);
  return date >= cycleStartsOn(key, cycleDay) ? cycleBounds(key, cycleDay) : cycleBounds(shiftCycleKey(key, -1), cycleDay);
}

/** Dia em que a agenda do ciclo abre para reservas (dia de virada). */
export function cycleBookingOpensOn(key: string, cycleDay: number, bookingOpensDay: number): IsoDate {
  assertDay(bookingOpensDay, 'dia de virada');
  const start = cycleStartsOn(key, cycleDay);
  const { year, month } = parseKey(key);
  const sameMonth = dueDateForCompetence(year, month, bookingOpensDay);
  if (sameMonth <= start) return sameMonth;
  const prev = parseKey(shiftCycleKey(key, -1));
  return dueDateForCompetence(prev.year, prev.month, bookingOpensDay);
}

export interface CycleContractTerms {
  cycleDay: number;
  bookingOpensDay: number;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
}

/** Ciclo aberto para reservas, já recortado ao período do contrato. */
export interface OpenCycle extends ContractCycle {
  /** Primeira e última data reservável (ciclo ∩ vigência do contrato). */
  bookableFrom: IsoDate;
  bookableUntil: IsoDate;
}

/**
 * Ciclos em que o residente pode reservar hoje: o atual e, depois do dia de virada, o seguinte —
 * sempre dentro da vigência do contrato. Um contrato que ainda não começou abre o seu primeiro
 * ciclo no dia de virada dele.
 */
export function openCycles(terms: CycleContractTerms, today: IsoDate): OpenCycle[] {
  const current = cycleForDate(today, terms.cycleDay);
  const next = cycleBounds(shiftCycleKey(current.key, 1), terms.cycleDay);
  const candidates = [current];
  if (today >= cycleBookingOpensOn(next.key, terms.cycleDay, terms.bookingOpensDay)) candidates.push(next);
  const out: OpenCycle[] = [];
  for (const c of candidates) {
    const from = c.startsOn > terms.startsOn ? c.startsOn : terms.startsOn;
    const until = terms.endsOn && terms.endsOn < c.endsOn ? terms.endsOn : c.endsOn;
    if (from > until) continue;
    out.push({ ...c, bookableFrom: from > today ? from : today, bookableUntil: until });
  }
  return out.filter((c) => c.bookableFrom <= c.bookableUntil);
}

/** Ciclos que cruzam a vigência do contrato entre duas datas (inclusive). */
export function cyclesBetween(from: IsoDate, until: IsoDate, cycleDay: number): ContractCycle[] {
  const out: ContractCycle[] = [];
  let c = cycleForDate(from, cycleDay);
  while (c.startsOn <= until) {
    out.push(c);
    c = cycleBounds(shiftCycleKey(c.key, 1), cycleDay);
  }
  return out;
}
