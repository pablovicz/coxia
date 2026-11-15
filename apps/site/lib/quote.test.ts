import { describe, expect, it } from 'vitest';
import { maskPhone, readQuoteForm } from './quote';

const form = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe('formulário de orçamento', () => {
  it('monta o envio com vários serviços e sem data', () => {
    const { payload, errors } = readQuoteForm(
      form([
        ['name', ' Marina Lopes '],
        ['email', 'marina@exemplo.com'],
        ['phone', '(41) 98888-7777'],
        ['segment', 'theater'],
        ['services', 'costume'],
        ['services', 'props'],
        ['description', 'Figurino para 6 atores.'],
        ['neededBy', ''],
        ['website', ''],
      ]),
    );
    expect(errors).toEqual({});
    expect(payload).toEqual({
      name: 'Marina Lopes',
      email: 'marina@exemplo.com',
      phone: '(41) 98888-7777',
      segment: 'theater',
      services: ['costume', 'props'],
      description: 'Figurino para 6 atores.',
      neededBy: null,
      spaceSlug: null,
      website: '',
    });
  });

  it('aponta cada campo obrigatório que falta', () => {
    const { errors } = readQuoteForm(form([['email', 'x@'], ['phone', '123']]));
    expect(Object.keys(errors).sort()).toEqual(['description', 'email', 'name', 'phone', 'segment', 'services']);
  });

  it('máscara do WhatsApp', () => {
    expect(maskPhone('41999071145')).toBe('(41) 99907-1145');
    expect(maskPhone('4133334444')).toBe('(41) 3333-4444');
    expect(maskPhone('419')).toBe('(41) 9');
    expect(maskPhone('')).toBe('');
  });
});
