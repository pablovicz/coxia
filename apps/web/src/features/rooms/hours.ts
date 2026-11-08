import type { OpeningRule } from '@/lib/api';

export const WEEKDAYS = [
  { n: 1, short: 'Seg', long: 'segunda' },
  { n: 2, short: 'Ter', long: 'terça' },
  { n: 3, short: 'Qua', long: 'quarta' },
  { n: 4, short: 'Qui', long: 'quinta' },
  { n: 5, short: 'Sex', long: 'sexta' },
  { n: 6, short: 'Sáb', long: 'sábado' },
  { n: 7, short: 'Dom', long: 'domingo' },
] as const;

const hour = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
};

/** O formulário edita um horário único para os dias marcados. */
export interface SimpleHours {
  days: number[];
  opensAt: string;
  closesAt: string;
  /** As regras salvas tinham horários diferentes por dia (salvar unifica). */
  mixed: boolean;
}

export function toSimpleHours(rules: OpeningRule[]): SimpleHours {
  if (rules.length === 0) return { days: [], opensAt: '08:00', closesAt: '22:00', mixed: false };
  const days = [...new Set(rules.map((r) => r.weekday))].sort((a, b) => a - b);
  const opensAt = rules.map((r) => r.opensAt).sort()[0]!;
  const closesAt = rules.map((r) => r.closesAt).sort().at(-1)!;
  const mixed = rules.length !== days.length || rules.some((r) => r.opensAt !== opensAt || r.closesAt !== closesAt);
  return { days, opensAt, closesAt, mixed };
}

export const fromSimpleHours = (h: SimpleHours): OpeningRule[] =>
  [...h.days].sort((a, b) => a - b).map((weekday) => ({ weekday, opensAt: h.opensAt, closesAt: h.closesAt }));

export function sameRules(a: OpeningRule[], b: OpeningRule[]): boolean {
  const key = (r: OpeningRule[]) =>
    r
      .map((x) => `${x.weekday}-${x.opensAt}-${x.closesAt}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}

/** "Seg a sáb · 8h–22h", "Seg, qua e sex · 9h–18h", "Horários variados", "Sem horário definido". */
export function describeHours(rules: OpeningRule[]): string {
  if (rules.length === 0) return 'Sem horário definido';
  const h = toSimpleHours(rules);
  if (h.mixed) return 'Horários variados por dia';
  const names = h.days.map((d) => WEEKDAYS[d - 1]!.short.toLowerCase());
  const contiguous = h.days.every((d, i) => i === 0 || d === h.days[i - 1]! + 1);
  let days: string;
  if (h.days.length === 7) days = 'Todos os dias';
  else if (contiguous && h.days.length >= 3) days = `${names[0]} a ${names.at(-1)}`;
  else days = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
  return `${days.charAt(0).toUpperCase()}${days.slice(1)} · ${hour(h.opensAt)}–${hour(h.closesAt)}`;
}
