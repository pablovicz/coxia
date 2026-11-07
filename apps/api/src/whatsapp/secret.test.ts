import { describe, expect, it } from 'vitest';
import { secretMatches } from './whatsapp.module';

describe('secretMatches', () => {
  it('aceita somente o segredo exato', () => {
    expect(secretMatches('a'.repeat(32), 'a'.repeat(32))).toBe(true);
    expect(secretMatches('a'.repeat(31), 'a'.repeat(32))).toBe(false);
    expect(secretMatches('b'.repeat(32), 'a'.repeat(32))).toBe(false);
    expect(secretMatches('', 'a'.repeat(32))).toBe(false);
  });
});
