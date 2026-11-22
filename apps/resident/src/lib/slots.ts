import { DateTime } from 'luxon';

/** Reservas em blocos de 30 min, com pelo menos 1 h. */
export const STEP = 30;
export const MIN = 60;

export interface Slot {
  start: DateTime;
  /** Até onde dá para estender sem bater em outra reserva ou no fechamento. */
  freeUntil: DateTime;
}

/** Inícios possíveis (de 30 em 30 min) nos intervalos livres do dia, a partir de agora. */
export function slotsOf(free: Array<{ start: string; end: string }>, tz: string, now: DateTime): Slot[] {
  const out: Slot[] = [];
  for (const i of free) {
    const end = DateTime.fromISO(i.end).setZone(tz);
    let s = DateTime.fromISO(i.start).setZone(tz);
    const rem = s.minute % STEP;
    if (rem || s.second || s.millisecond) s = s.set({ second: 0, millisecond: 0 }).plus({ minutes: rem ? STEP - rem : 0 });
    for (; s.plus({ minutes: MIN }) <= end; s = s.plus({ minutes: STEP })) {
      if (s < now) continue;
      out.push({ start: s, freeUntil: end });
    }
  }
  return out;
}
