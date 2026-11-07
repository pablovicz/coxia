import { DateTime } from 'luxon';
import type { IsoDate } from './time';

/** Formatação pt-BR estável para mensagens (sem espaços não separáveis, que variam por ICU). */
const clean = (s: string) => s.replace(/[  ]/g, ' ');

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: number): string {
  return clean(brl.format(cents / 100));
}

/** "R$ 1.234,56", "1234,56", "1.234", "480" → centavos. Retorna null se não for um valor. */
export function parseBRL(input: string): number | null {
  const m = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/.exec(input.replace(/\s/g, ''));
  if (!m) return null;
  const reais = Number(m[1]!.replace(/\./g, ''));
  const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return reais * 100 + cents;
}

const WEEKDAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const WEEKDAYS_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/** "14h" / "14h30" no fuso informado. */
export function formatHour(instant: Date, timezone: string): string {
  const dt = DateTime.fromJSDate(instant, { zone: timezone });
  return dt.minute === 0 ? `${dt.hour}h` : `${dt.hour}h${String(dt.minute).padStart(2, '0')}`;
}

export function formatTimeRange(start: Date, end: Date, timezone: string): string {
  return `${formatHour(start, timezone)}–${formatHour(end, timezone)}`;
}

/** "sex, 13/11" */
export function formatShortDate(date: IsoDate): string {
  const dt = DateTime.fromISO(date, { zone: 'UTC' });
  return `${WEEKDAYS_SHORT[dt.weekday - 1]}, ${dt.toFormat('dd/MM')}`;
}

/** "sexta-feira, 13 de novembro" */
export function formatLongDate(date: IsoDate): string {
  const dt = DateTime.fromISO(date, { zone: 'UTC' }).setLocale('pt-BR');
  const weekday = WEEKDAYS[dt.weekday - 1]!;
  const full = ['sábado', 'domingo'].includes(weekday) ? weekday : `${weekday}-feira`;
  return `${full}, ${dt.day} de ${dt.toFormat('MMMM')}`;
}

/** "novembro de 2026" para a competência "2026-11". */
export function formatCompetence(competence: string): string {
  return DateTime.fromISO(`${competence}-01`, { zone: 'UTC' }).setLocale('pt-BR').toFormat("MMMM 'de' yyyy");
}

/** Remove acentos, caixa e espaços extras — para casar "sala média" com "Sala Media". */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
