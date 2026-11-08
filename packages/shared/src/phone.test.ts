import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('mantém só os dígitos de um telefone', () => {
    expect(normalizePhone('+55 (11) 99999-0000')).toBe('5511999990000');
    expect(normalizePhone('5511999990000@c.us')).toBe('5511999990000');
    expect(normalizePhone('5511999990000@s.whatsapp.net')).toBe('5511999990000');
  });

  it('não confunde @lid nem ID de grupo com telefone', () => {
    expect(normalizePhone('81896604192873@lid')).toBeNull();
    expect(normalizePhone('120363019502650977-group')).toBeNull();
    expect(normalizePhone('120363019502650977@g.us')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('normalizeBrPhone', () => {
  it('completa o 55 em número brasileiro com DDD', async () => {
    const { normalizeBrPhone } = await import('./phone');
    expect(normalizeBrPhone('(11) 98765-1111')).toBe('5511987651111');
    expect(normalizeBrPhone('11 3333-4444')).toBe('551133334444');
    expect(normalizeBrPhone('+55 11 98765-1111')).toBe('5511987651111');
    expect(normalizeBrPhone('5511987651111')).toBe('5511987651111');
    // DDD 55 (RS) sem DDI: ganha o 55 do país.
    expect(normalizeBrPhone('55 99999-1234')).toBe('5555999991234');
    expect(normalizeBrPhone('+351 912 345 678')).toBe('351912345678');
    expect(normalizeBrPhone('')).toBeNull();
  });
});
