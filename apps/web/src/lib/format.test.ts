import { describe, expect, it } from 'vitest';
import { formatPhone, rentalPriceCents } from '@coxia/ui/lib/format';

describe('formatPhone', () => {
  it('celular e fixo brasileiros', () => {
    expect(formatPhone('5511987654321')).toBe('+55 11 98765-4321');
    expect(formatPhone('551133334444')).toBe('+55 11 3333-4444');
  });
  it('outros países ficam só com +', () => {
    expect(formatPhone('351912345678')).toBe('+351912345678');
  });
});

describe('rentalPriceCents', () => {
  // Sala de ensaio menor: R$ 35/h, R$ 119 o período de 4h.
  it('período completo pelo valor do período, o resto por hora', () => {
    expect(rentalPriceCents(120, 3500, 11900)).toBe(7000);
    expect(rentalPriceCents(240, 3500, 11900)).toBe(11900);
    expect(rentalPriceCents(300, 3500, 11900)).toBe(11900 + 3500);
    expect(rentalPriceCents(480, 3500, 11900)).toBe(23800);
  });
  it('as horas que sobram não passam do valor de um período', () => {
    // Estúdio: R$ 80/h, R$ 300 o período → 7h = 300 + min(240, 300).
    expect(rentalPriceCents(420, 8000, 30000)).toBe(54000);
    // Atelier: R$ 45/h, R$ 135 o período → 3h já custa um período.
    expect(rentalPriceCents(180, 4500, 13500)).toBe(13500);
    expect(rentalPriceCents(210, 4500, 13500)).toBe(13500);
  });
  it('sem valor de período, só por hora', () => {
    expect(rentalPriceCents(300, 4500, null)).toBe(22500);
    expect(rentalPriceCents(90, null, null)).toBeNull();
  });
});
