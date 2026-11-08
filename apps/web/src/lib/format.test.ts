import { describe, expect, it } from 'vitest';
import { formatPhone } from './format';

describe('formatPhone', () => {
  it('celular e fixo brasileiros', () => {
    expect(formatPhone('5511987654321')).toBe('+55 11 98765-4321');
    expect(formatPhone('551133334444')).toBe('+55 11 3333-4444');
  });
  it('outros países ficam só com +', () => {
    expect(formatPhone('351912345678')).toBe('+351912345678');
  });
});
