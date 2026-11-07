import { describe, expect, it } from 'vitest';
import { formatBRL, formatCompetence, formatHour, formatLongDate, formatShortDate, normalizeText, parseBRL } from './format';
import { expandDates, formatRRule, isoWeekday, parseRRule } from './recurrence';

describe('golden: recorrência semanal', () => {
  it('"Toda terça, 19h–21h" a partir de 10/11/2026', () => {
    const rule = parseRRule('FREQ=WEEKLY;BYDAY=TU');
    expect(expandDates(rule, '2026-11-10', '2026-11-01', '2026-12-08')).toEqual([
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
      '2026-12-01',
      '2026-12-08',
    ]);
  });

  it('sem BYDAY usa o dia da semana da data inicial', () => {
    const rule = parseRRule('FREQ=WEEKLY');
    expect(expandDates(rule, '2026-11-13', '2026-11-13', '2026-11-27')).toEqual(['2026-11-13', '2026-11-20', '2026-11-27']);
  });

  it('INTERVAL=2, vários dias, UNTIL e janela parcial', () => {
    const rule = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261203');
    expect(expandDates(rule, '2026-11-09', '2026-11-10', '2026-12-31')).toEqual(['2026-11-12', '2026-11-23', '2026-11-26']);
  });

  it('COUNT conta desde o início, mesmo com janela posterior', () => {
    const rule = parseRRule('FREQ=WEEKLY;BYDAY=TU;COUNT=3');
    expect(expandDates(rule, '2026-11-10', '2026-11-20', '2027-01-31')).toEqual(['2026-11-24']);
  });

  it('round-trip parse/format', () => {
    const s = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261203';
    expect(formatRRule(parseRRule(s))).toBe(s);
    expect(isoWeekday('2026-11-10')).toBe(2);
  });

  it('rejeita o que não suportamos', () => {
    expect(() => parseRRule('FREQ=DAILY')).toThrow(RangeError);
    expect(() => parseRRule('FREQ=WEEKLY;BYHOUR=10')).toThrow(RangeError);
    expect(() => parseRRule('FREQ=WEEKLY;BYDAY=XX')).toThrow(RangeError);
  });
});

describe('golden: recorrência mensal com dia 31', () => {
  it('cai no último dia em meses curtos', () => {
    const rule = parseRRule('FREQ=MONTHLY;BYMONTHDAY=31');
    expect(expandDates(rule, '2026-01-31', '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });
});

describe('formatação pt-BR', () => {
  it('moeda', () => {
    expect(formatBRL(48000)).toBe('R$ 480,00');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
  });
  it.each([
    ['R$ 480,00', 48000],
    ['1.234,56', 123456],
    ['paguei 2.500', 250000],
    ['R$ 149,9', 14990],
    ['sem valor', null],
  ])('parseBRL(%s) = %s', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });
  it('datas e horas', () => {
    expect(formatHour(new Date('2026-11-13T17:00:00Z'), 'America/Sao_Paulo')).toBe('14h');
    expect(formatHour(new Date('2026-11-13T17:30:00Z'), 'America/Sao_Paulo')).toBe('14h30');
    expect(formatShortDate('2026-11-13')).toBe('sex, 13/11');
    expect(formatLongDate('2026-11-13')).toBe('sexta-feira, 13 de novembro');
    expect(formatLongDate('2026-11-14')).toBe('sábado, 14 de novembro');
    expect(formatCompetence('2026-02')).toBe('fevereiro de 2026');
    expect(normalizeText('  Sala   MÉDIA ')).toBe('sala media');
  });
});
