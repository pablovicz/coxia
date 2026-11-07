import { DateTime } from 'luxon';

/** Formatação e conversão de datas no fuso da organização (nunca no fuso do navegador). */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatBRL = (cents: number) => brl.format(cents / 100).replace(/ /g, ' ');

/** "1.234,56" / "480" / "R$ 149,90" → centavos; null se inválido. */
export function parseBRL(input: string): number | null {
  const clean = input.replace(/[R$\s]/g, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(clean)) return null;
  const [reais, cents = ''] = clean.replace(/\./g, '').split(',');
  return Number(reais) * 100 + Number(cents.padEnd(2, '0'));
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export const local = (iso: string | Date, tz: string) =>
  (typeof iso === 'string' ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso)).setZone(tz).setLocale('pt-BR');

export const todayIn = (tz: string) => DateTime.now().setZone(tz).toISODate()!;

/** Data + hora locais (fuso da organização) → ISO com offset, para a API. */
export function toZonedIso(date: string, time: string, tz: string): string {
  return DateTime.fromISO(`${date}T${time}`, { zone: tz }).toISO({ suppressMilliseconds: true })!;
}

/** Limites [início, fim) do dia local em ISO. */
export function dayRange(date: string, tz: string) {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day');
  return { from: start.toISO()!, to: start.plus({ days: 1 }).toISO()! };
}

export function weekDays(date: string, tz: string): string[] {
  const monday = DateTime.fromISO(date, { zone: tz }).startOf('week');
  return Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).toISODate()!);
}

export function shiftDate(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

export function shiftCompetence(competence: string, months: number): string {
  return DateTime.fromISO(`${competence}-01`).plus({ months }).toFormat('yyyy-MM');
}

export const formatTime = (iso: string, tz: string) => {
  const d = local(iso, tz);
  return d.minute === 0 ? `${d.hour}h` : `${d.hour}h${String(d.minute).padStart(2, '0')}`;
};
export const formatRange = (start: string, end: string, tz: string) => `${formatTime(start, tz)}–${formatTime(end, tz)}`;
export const formatDayTitle = (date: string) => DateTime.fromISO(date).setLocale('pt-BR').toFormat("cccc, d 'de' LLLL");
export const formatShortDay = (date: string) => DateTime.fromISO(date).setLocale('pt-BR').toFormat('ccc dd');
export const formatCompetence = (c: string) => DateTime.fromISO(`${c}-01`).setLocale('pt-BR').toFormat("LLLL 'de' yyyy");
export const formatDueDate = (date: string) => {
  const d = DateTime.fromISO(date.slice(0, 10)).setLocale('pt-BR');
  return { month: d.toFormat('LLL').replace('.', ''), day: d.toFormat('dd') };
};
export const isoDateOnly = (s: string) => s.slice(0, 10);
