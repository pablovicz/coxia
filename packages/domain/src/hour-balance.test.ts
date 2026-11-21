import { describe, expect, it } from 'vitest';
import { attendanceOf, type BalanceGrant, type BalanceOccurrence, canAfford, cycleBalance, cycleLedger, formatMinutes } from './hour-balance';

const TZ = 'America/Sao_Paulo';
const terms = { cycleDay: 1, timezone: TZ };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-21T10:00');
const grant = (cycle: string, minutes: number, kind: BalanceGrant['kind'] = 'monthly'): BalanceGrant => ({ cycle, kind, minutes, createdAt: at(`${cycle}-01T00:00`) });
let n = 0;
const occ = (start: string, end: string, extra: Partial<BalanceOccurrence> = {}): BalanceOccurrence => ({
  id: `o${++n}`,
  startAt: at(start),
  endAt: at(end),
  status: 'confirmed',
  checkedInAt: null,
  ...extra,
});

describe('saldo de horas do contrato', () => {
  it('reservas comprometem; passadas (com ou sem check-in) contam como usadas', () => {
    const b = cycleBalance(
      '2026-11',
      [grant('2026-11', 20 * 60)],
      [
        occ('2026-11-10T14:00', '2026-11-10T18:00', { checkedInAt: at('2026-11-10T14:05') }),
        occ('2026-11-12T14:00', '2026-11-12T16:00'), // falta: consome mesmo assim
        occ('2026-11-24T14:00', '2026-11-24T17:00'),
        occ('2026-11-25T14:00', '2026-11-25T17:00', { status: 'cancelled' }), // cancelada devolve
      ],
      terms,
      NOW,
    );
    expect(b).toMatchObject({ grantedMinutes: 1200, usedMinutes: 360, reservedMinutes: 180, availableMinutes: 660, renewsOn: '2026-12-01' });
  });

  it('as horas NÃO acumulam: a sobra do ciclo anterior não passa para o seguinte', () => {
    const grants = [grant('2026-10', 600), grant('2026-11', 600)];
    const b = cycleBalance('2026-11', grants, [occ('2026-10-05T10:00', '2026-10-05T11:00')], terms, NOW);
    expect(b.availableMinutes).toBe(600);
  });

  it('check-in atrasado debita a reserva inteira', () => {
    const late = occ('2026-11-21T08:00', '2026-11-21T12:00', { checkedInAt: at('2026-11-21T09:30') });
    expect(cycleBalance('2026-11', [grant('2026-11', 600)], [late], terms, NOW).availableMinutes).toBe(600 - 240);
  });

  it('ajustes da equipe somam ou subtraem no ciclo; saldo pode ficar negativo', () => {
    const grants = [grant('2026-11', 600), grant('2026-11', 120, 'adjustment'), grant('2026-11', -900, 'adjustment')];
    const b = cycleBalance('2026-11', grants, [], terms, NOW);
    expect(b).toMatchObject({ adjustedMinutes: -780, availableMinutes: -180 });
  });

  it('a reserva consome o ciclo do dia em que começa (dia de reset 5)', () => {
    const t = { cycleDay: 5, timezone: TZ };
    const grants = [grant('2026-11', 240), grant('2026-12', 240)];
    const o = [occ('2026-12-04T10:00', '2026-12-04T14:00')];
    expect(cycleBalance('2026-11', grants, o, t, NOW).availableMinutes).toBe(0);
    expect(cycleBalance('2026-12', grants, o, t, NOW).availableMinutes).toBe(240);
  });

  it('canAfford confere cada ciclo separadamente', () => {
    const grants = [grant('2026-11', 240), grant('2026-12', 240)];
    const ok = canAfford([{ start: at('2026-11-28T10:00'), end: at('2026-11-28T14:00') }, { start: at('2026-12-02T10:00'), end: at('2026-12-02T14:00') }], grants, [], terms, NOW);
    expect(ok.ok).toBe(true);
    const short = canAfford([{ start: at('2026-11-28T10:00'), end: at('2026-11-28T14:30') }], grants, [], terms, NOW);
    expect(short).toEqual({ ok: false, shortfalls: [{ cycle: '2026-11', neededMinutes: 270, availableMinutes: 240 }] });
  });

  it('extrato ordena concessão, ajustes e reservas', () => {
    const l = cycleLedger('2026-11', [grant('2026-11', 600)], [occ('2026-11-24T14:00', '2026-11-24T15:00')], terms, NOW);
    expect(l.map((e) => [e.kind, e.minutes, e.attendance])).toEqual([
      ['monthly', 600, undefined],
      ['booking', -60, 'upcoming'],
    ]);
  });

  it('presença', () => {
    const o = { startAt: at('2026-11-21T09:00'), endAt: at('2026-11-21T11:00'), checkedInAt: null };
    expect(attendanceOf(o, NOW)).toBe('in_progress');
    expect(attendanceOf(o, at('2026-11-21T11:00'))).toBe('no_show');
    expect(attendanceOf(o, at('2026-11-21T08:00'))).toBe('upcoming');
  });

  it('formata minutos', () => {
    expect([formatMinutes(750), formatMinutes(240), formatMinutes(30), formatMinutes(-120)]).toEqual(['12h30', '4h', '30min', '−2h']);
  });
});
