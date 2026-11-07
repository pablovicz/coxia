import { describe, expect, it } from 'vitest';
import {
  addDays,
  assertValidInterval,
  competenceKey,
  dueDateForCompetence,
  intervalsOverlap,
  localDateOf,
  localDayBoundsUtc,
  zonedToUtc,
} from './time';

const TZ = 'America/Sao_Paulo';

describe('dueDateForCompetence — golden: dia 31 em meses curtos', () => {
  it.each([
    [2026, 1, 31, '2026-01-31'],
    [2026, 2, 31, '2026-02-28'],
    [2028, 2, 31, '2028-02-29'], // bissexto
    [2026, 2, 29, '2026-02-28'],
    [2026, 4, 31, '2026-04-30'],
    [2026, 4, 30, '2026-04-30'],
    [2026, 12, 5, '2026-12-05'],
  ])('%i-%i dia %i → %s', (y, m, d, expected) => {
    expect(dueDateForCompetence(y, m, d)).toBe(expected);
  });

  it('rejeita dia fora de 1..31', () => {
    expect(() => dueDateForCompetence(2026, 1, 0)).toThrow(RangeError);
    expect(() => dueDateForCompetence(2026, 1, 32)).toThrow(RangeError);
  });
});

describe('aviso D-1', () => {
  it('cruza a virada de mês e de ano', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('fuso da organização', () => {
  it('08:00 em São Paulo é 11:00 UTC (sem horário de verão desde 2019)', () => {
    expect(zonedToUtc('2026-11-06', '08:00', TZ).toISOString()).toBe('2026-11-06T11:00:00.000Z');
  });

  it('o dia local termina às 03:00 UTC do dia seguinte', () => {
    const { start, end } = localDayBoundsUtc('2026-11-06', TZ);
    expect(start.toISOString()).toBe('2026-11-06T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-07T03:00:00.000Z');
  });

  it('um instante UTC de madrugada ainda pertence ao dia local anterior', () => {
    expect(localDateOf(new Date('2026-11-07T02:30:00Z'), TZ)).toBe('2026-11-06');
  });

  it('rejeita fuso inválido', () => {
    expect(() => zonedToUtc('2026-11-06', '08:00', 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('intervalos', () => {
  const d = (s: string) => new Date(s);
  it('intervalos encostados não conflitam ([) semiaberto)', () => {
    expect(
      intervalsOverlap(d('2026-11-06T14:00Z'), d('2026-11-06T17:00Z'), d('2026-11-06T17:00Z'), d('2026-11-06T19:00Z')),
    ).toBe(false);
  });
  it('sobreposição parcial conflita', () => {
    expect(
      intervalsOverlap(d('2026-11-06T14:00Z'), d('2026-11-06T17:00Z'), d('2026-11-06T16:59Z'), d('2026-11-06T19:00Z')),
    ).toBe(true);
  });
  it('exige start < end', () => {
    expect(() => assertValidInterval(d('2026-11-06T14:00Z'), d('2026-11-06T14:00Z'))).toThrow();
  });
  it('competenceKey', () => {
    expect(competenceKey(2026, 2)).toBe('2026-02');
  });
});
