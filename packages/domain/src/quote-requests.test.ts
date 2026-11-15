import { describe, expect, it } from 'vitest';
import { composeQuoteRequestNotice, projectDraftFromQuote } from './quote-requests';

describe('aviso de pedido de orçamento', () => {
  it('traz quem pediu, contato, segmento, serviços em português, data e a descrição', () => {
    const text = composeQuoteRequestNotice({
      name: 'Marina Lopes',
      email: 'marina@exemplo.com',
      phone: '5541999071145',
      segment: 'theater',
      services: ['costume', 'props'],
      description: 'Figurino para 6 atores, estreia em dezembro.',
      neededBy: '2026-12-20',
    });
    expect(text).toBe(
      [
        '📩 *Novo pedido de orçamento pelo site*',
        '',
        '*Marina Lopes*',
        'WhatsApp: +55 41 99907-1145',
        'E-mail: marina@exemplo.com',
        'Segmento: Teatro',
        'Serviços: Figurino, Adereços',
        'Para quando: 20/12/2026',
        '',
        'Figurino para 6 atores, estreia em dezembro.',
        '',
        'Veja e acompanhe em Coxia → Pedidos.',
      ].join('\n'),
    );
  });

  it('sem data, sem a linha; descrição longa é cortada', () => {
    const text = composeQuoteRequestNotice({
      name: 'A',
      email: 'a@b.co',
      phone: '351912345678',
      segment: 'other',
      services: ['space_rental'],
      description: 'x'.repeat(700),
      neededBy: null,
    });
    expect(text).not.toContain('Para quando');
    expect(text).toContain('WhatsApp: +351912345678');
    expect(text).toContain('Serviços: Aluguel de espaço');
    expect(text).toContain(`${'x'.repeat(600)}…`);
  });
});

describe('promover a projeto', () => {
  it('nome com o primeiro serviço e o cliente; objetivo com a descrição e os dados do pedido', () => {
    expect(
      projectDraftFromQuote({ name: 'Marina Lopes', segment: 'theater', services: ['costume', 'props'], description: 'Figurino para 6 atores.', neededBy: '2026-12-20' }),
    ).toEqual({
      title: 'Figurino - Marina Lopes',
      objective: 'Figurino para 6 atores.\n\nCliente: Marina Lopes · Segmento: Teatro · Serviços: Figurino, Adereços · Para quando: 20/12/2026',
    });
  });

  it('pedido pela página da sala: o nome do projeto e o objetivo citam o espaço', () => {
    const d = projectDraftFromQuote({ name: 'Estúdio Lume', segment: 'audiovisual', services: ['space_rental'], description: 'Diária para ensaio de moda.', neededBy: null, space: { name: 'Estúdio fotográfico' } });
    expect(d.title).toBe('Estúdio fotográfico - Estúdio Lume');
    expect(d.objective).toBe('Diária para ensaio de moda.\n\nCliente: Estúdio Lume · Segmento: Audiovisual · Serviços: Aluguel de espaço · Espaço: Estúdio fotográfico');
    const notice = composeQuoteRequestNotice({ name: 'A', email: 'a@b.co', phone: '5541988887777', segment: 'audiovisual', services: ['space_rental'], description: 'Diária.', neededBy: null, spaceName: 'Estúdio fotográfico' });
    expect(notice).toContain('Serviços: Aluguel de espaço\nEspaço: Estúdio fotográfico');
  });

  it('descrição longa cabe no limite do objetivo (2.000)', () => {
    const d = projectDraftFromQuote({ name: 'A', segment: 'other', services: ['other'], description: 'x'.repeat(4000), neededBy: null });
    expect(d.objective.length).toBeLessThanOrEqual(2000);
    expect(d.objective).toContain('…\n\nCliente: A');
  });
});
