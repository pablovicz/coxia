import { describe, expect, it } from 'vitest';
import { cycleBookingOpensOn, cycleBounds, cycleForDate, cyclesBetween, openCycles, shiftCycleKey } from './cycles';

describe('ciclos do contrato', () => {
  it('desloca a chave do ciclo entre anos', () => {
    expect(shiftCycleKey('2026-12', 1)).toBe('2027-01');
    expect(shiftCycleKey('2027-01', -1)).toBe('2026-12');
    expect(shiftCycleKey('2026-11', 14)).toBe('2028-01');
  });

  it.each([
    // [data, dia do ciclo, ciclo, início, fim]
    ['2026-11-21', 1, '2026-11', '2026-11-01', '2026-11-30'],
    ['2026-11-04', 5, '2026-10', '2026-10-05', '2026-11-04'],
    ['2026-11-05', 5, '2026-11', '2026-11-05', '2026-12-04'],
    // dia 31: fevereiro cai no dia 28 e o ciclo de janeiro termina na véspera
    ['2027-02-27', 31, '2027-01', '2027-01-31', '2027-02-27'],
    ['2027-02-28', 31, '2027-02', '2027-02-28', '2027-03-30'],
    ['2028-02-29', 30, '2028-02', '2028-02-29', '2028-03-29'],
  ])('%s com ciclo no dia %i → %s (%s a %s)', (date, day, key, start, end) => {
    expect(cycleForDate(date, day)).toEqual({ key, startsOn: start, endsOn: end });
  });

  it('dias consecutivos sempre caem em exatamente um ciclo', () => {
    const c = cycleBounds('2027-01', 31);
    expect(cycleForDate(c.endsOn, 31).key).toBe('2027-01');
    expect(cycleForDate('2027-02-28', 31).key).toBe('2027-02');
  });

  it.each([
    // [ciclo, dia do ciclo, dia de virada, abre em]
    ['2026-12', 1, 25, '2026-11-25'],
    ['2026-12', 10, 5, '2026-12-05'],
    ['2026-12', 5, 5, '2026-12-05'], // virada = reset
    ['2027-03', 1, 31, '2027-02-28'],
  ])('ciclo %s (dia %i) com virada no dia %i abre em %s', (key, cycleDay, opens, expected) => {
    expect(cycleBookingOpensOn(key, cycleDay, opens)).toBe(expected);
  });

  describe('openCycles', () => {
    const terms = { cycleDay: 1, bookingOpensDay: 25, startsOn: '2026-01-01', endsOn: null };

    it('antes da virada só o ciclo atual, a partir de hoje', () => {
      expect(openCycles(terms, '2026-11-21')).toEqual([
        { key: '2026-11', startsOn: '2026-11-01', endsOn: '2026-11-30', bookableFrom: '2026-11-21', bookableUntil: '2026-11-30' },
      ]);
    });

    it('depois da virada o ciclo seguinte também abre', () => {
      expect(openCycles(terms, '2026-11-25').map((c) => c.key)).toEqual(['2026-11', '2026-12']);
      expect(openCycles(terms, '2026-11-25')[1]!.bookableFrom).toBe('2026-12-01');
    });

    it('respeita o fim do contrato', () => {
      const ending = { ...terms, endsOn: '2026-11-27' };
      expect(openCycles(ending, '2026-11-26')).toEqual([
        { key: '2026-11', startsOn: '2026-11-01', endsOn: '2026-11-30', bookableFrom: '2026-11-26', bookableUntil: '2026-11-27' },
      ]);
    });

    it('contrato que começa no próximo ciclo abre na virada', () => {
      const future = { ...terms, startsOn: '2026-12-01' };
      expect(openCycles(future, '2026-11-20')).toEqual([]);
      expect(openCycles(future, '2026-11-25').map((c) => c.key)).toEqual(['2026-12']);
    });

    it('contrato que começa no meio do ciclo reserva a partir do início dele', () => {
      const mid = { ...terms, startsOn: '2026-11-23' };
      expect(openCycles(mid, '2026-11-21')[0]!.bookableFrom).toBe('2026-11-23');
    });
  });

  it('cyclesBetween lista os ciclos que cruzam o período', () => {
    expect(cyclesBetween('2026-11-10', '2027-01-04', 5).map((c) => c.key)).toEqual(['2026-11', '2026-12']);
    expect(cyclesBetween('2026-11-10', '2027-01-05', 5).map((c) => c.key)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});
