import { describe, expect, it } from 'vitest';
import { monthGrid, monthsOf, periodOf, shiftPeriod } from './calendar';

describe('períodos da agenda', () => {
  it('semana começa na segunda', () => {
    expect(periodOf('semana', '2026-11-13')).toEqual({ start: '2026-11-09', end: '2026-11-16', title: 'Semana de 09/11 a 15/11' });
    expect(shiftPeriod('semana', '2026-11-13', 1)).toBe('2026-11-16');
  });

  it('mês, trimestre, semestre e ano', () => {
    expect(periodOf('mes', '2026-11-13')).toEqual({ start: '2026-11-01', end: '2026-12-01', title: 'Novembro de 2026' });
    expect(periodOf('trimestre', '2026-11-13')).toEqual({ start: '2026-10-01', end: '2027-01-01', title: '4º trimestre de 2026 · out–dez' });
    expect(periodOf('semestre', '2026-11-13')).toEqual({ start: '2026-07-01', end: '2027-01-01', title: '2º semestre de 2026 · jul–dez' });
    expect(periodOf('semestre', '2027-03-02').title).toBe('1º semestre de 2027 · jan–jun');
    expect(periodOf('ano', '2026-11-13')).toEqual({ start: '2026-01-01', end: '2027-01-01', title: '2026' });
  });

  it('navegação pula o período inteiro, inclusive na virada do ano', () => {
    expect(shiftPeriod('mes', '2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftPeriod('trimestre', '2026-11-13', 1)).toBe('2027-01-01');
    expect(shiftPeriod('trimestre', '2026-02-10', -1)).toBe('2025-10-01');
    expect(shiftPeriod('semestre', '2026-11-13', -1)).toBe('2026-01-01');
    expect(shiftPeriod('ano', '2026-11-13', 1)).toBe('2027-01-01');
  });

  it('meses do período', () => {
    expect(monthsOf('trimestre', '2026-11-13')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
    expect(monthsOf('ano', '2026-05-05')).toHaveLength(12);
  });

  it('grade do mês começa na segunda e só tem as semanas necessárias', () => {
    const nov = monthGrid('2026-11-01'); // 1/11/2026 é domingo
    expect(nov[0]).toEqual({ date: '2026-10-26', inMonth: false });
    expect(nov[6]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(nov.length % 7).toBe(0);
    expect(nov.at(-1)!.date).toBe('2026-12-06');
    // Fevereiro de 2027 começa na segunda e cabe em 4 semanas.
    expect(monthGrid('2027-02-01')).toHaveLength(28);
  });
});
