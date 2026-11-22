import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { slotsOf } from './slots';

const TZ = 'America/Sao_Paulo';
const at = (local: string) => DateTime.fromISO(local, { zone: TZ });

describe('horários de início', () => {
  it('blocos de 30 min que cabem pelo menos 1 h no intervalo livre', () => {
    const free = [{ start: at('2026-11-24T08:00').toISO()!, end: at('2026-11-24T10:00').toISO()! }];
    const slots = slotsOf(free, TZ, at('2026-11-20T00:00'));
    expect(slots.map((s) => s.start.toFormat('HH:mm'))).toEqual(['08:00', '08:30', '09:00']);
    expect(slots[0]!.freeUntil.toFormat('HH:mm')).toBe('10:00');
  });

  it('intervalo livre quebrado (depois de uma reserva às 14h20) começa na próxima meia hora', () => {
    const free = [{ start: at('2026-11-24T14:20').toISO()!, end: at('2026-11-24T16:00').toISO()! }];
    expect(slotsOf(free, TZ, at('2026-11-20T00:00')).map((s) => s.start.toFormat('HH:mm'))).toEqual(['14:30', '15:00']);
  });

  it('não oferece horários que já passaram', () => {
    const free = [{ start: at('2026-11-24T08:00').toISO()!, end: at('2026-11-24T12:00').toISO()! }];
    expect(slotsOf(free, TZ, at('2026-11-24T09:10')).map((s) => s.start.toFormat('HH:mm'))).toEqual(['09:30', '10:00', '10:30', '11:00']);
  });
});
