import { DateTime } from 'luxon';

/** Visões da agenda. A semana é a padrão. */
export type AgendaView = 'semana' | 'mes' | 'trimestre' | 'semestre' | 'ano';

export const AGENDA_VIEWS: Array<{ id: AgendaView; label: string }> = [
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mês' },
  { id: 'trimestre', label: 'Trimestre' },
  { id: 'semestre', label: 'Semestre' },
  { id: 'ano', label: 'Ano' },
];

export const isAgendaView = (v: string | null): v is AgendaView => AGENDA_VIEWS.some((x) => x.id === v);

const MONTHS_IN: Record<Exclude<AgendaView, 'semana'>, number> = { mes: 1, trimestre: 3, semestre: 6, ano: 12 };

const d = (iso: string) => DateTime.fromISO(iso).setLocale('pt-BR');
const monthShort = (dt: DateTime) => dt.toFormat('LLL').replace('.', '');

/** Primeiro dia do período que contém `date` (datas locais ISO, sem fuso). */
export function periodStart(view: AgendaView, date: string): DateTime {
  const day = d(date);
  if (view === 'semana') return day.startOf('week');
  const size = MONTHS_IN[view];
  const firstMonth = Math.floor((day.month - 1) / size) * size + 1;
  return day.set({ month: firstMonth, day: 1 });
}

/** Período [start, end) em datas locais e o título para o cabeçalho. */
export function periodOf(view: AgendaView, date: string): { start: string; end: string; title: string } {
  const start = periodStart(view, date);
  const end = view === 'semana' ? start.plus({ days: 7 }) : start.plus({ months: MONTHS_IN[view] });
  const last = end.minus({ days: 1 });
  let title: string;
  switch (view) {
    case 'semana':
      title = `Semana de ${start.toFormat('dd/LL')} a ${last.toFormat('dd/LL')}`;
      break;
    case 'mes':
      title = start.toFormat("LLLL 'de' yyyy");
      break;
    case 'trimestre':
      title = `${Math.ceil(start.month / 3)}º trimestre de ${start.year} · ${monthShort(start)}–${monthShort(last)}`;
      break;
    case 'semestre':
      title = `${start.month === 1 ? 1 : 2}º semestre de ${start.year} · ${monthShort(start)}–${monthShort(last)}`;
      break;
    case 'ano':
      title = String(start.year);
      break;
  }
  return { start: start.toISODate()!, end: end.toISODate()!, title: title.charAt(0).toUpperCase() + title.slice(1) };
}

/** Avança/recua um período inteiro a partir do início do período atual. */
export function shiftPeriod(view: AgendaView, date: string, dir: 1 | -1): string {
  const start = periodStart(view, date);
  return (view === 'semana' ? start.plus({ days: 7 * dir }) : start.plus({ months: MONTHS_IN[view] * dir })).toISODate()!;
}

/** Primeiros dias dos meses do período (mês, trimestre, semestre, ano). */
export function monthsOf(view: Exclude<AgendaView, 'semana'>, date: string): string[] {
  const start = periodStart(view, date);
  return Array.from({ length: MONTHS_IN[view] }, (_, i) => start.plus({ months: i }).toISODate()!);
}

/** Grade de um mês começando na segunda: só as semanas necessárias (4 a 6 linhas). */
export function monthGrid(firstOfMonth: string): Array<{ date: string; inMonth: boolean }> {
  const first = d(firstOfMonth).startOf('month');
  const gridStart = first.startOf('week');
  const gridEnd = first.endOf('month').endOf('week');
  const days = Math.round(gridEnd.diff(gridStart, 'days').days);
  return Array.from({ length: days }, (_, i) => {
    const day = gridStart.plus({ days: i });
    return { date: day.toISODate()!, inMonth: day.month === first.month };
  });
}

export const WEEKDAY_HEADERS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
