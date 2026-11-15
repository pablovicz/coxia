/**
 * Pedidos de orçamento do site: validação, contato pelo WhatsApp, aviso às administradoras,
 * envio repetido e acompanhamento pela equipe.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, DomainError, ProjectService, QuoteRequestService } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const quotes = new QuoteRequestService(db);
const projects = new ProjectService(db);
const suffix = String(Date.now()).slice(-7);
const ANA = `554193${suffix}`;
let orgId: string;
let slug: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

const base = {
  name: 'Marina Lopes',
  email: 'Marina@Exemplo.com ',
  phone: `(41) 98${suffix.slice(0, 3)}-${suffix.slice(3)}`,
  segment: 'theater',
  services: ['costume', 'props'],
  description: 'Figurino para 6 atores, estreia em dezembro.',
  neededBy: '2026-12-20',
};

beforeAll(async () => {
  slug = `site-${randomUUID()}`;
  orgId = (await db.organization.create({ data: { name: 'Casa Site', slug } })).id;
  const mk = async (name: string, phone: string | null, role: 'owner' | 'admin' | 'staff') => {
    const u = await db.user.create({ data: { name: `${name} ${suffix}`, phone } });
    await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role } });
  };
  await mk('Ana', ANA, 'owner');
  await mk('Julia', null, 'admin');
  await mk('Bruno', `554194${suffix}`, 'staff');
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { name: { endsWith: suffix } } });
  await db.$disconnect();
});

describe('pedido de orçamento pelo site', () => {
  it('organização do site pelo slug', async () => {
    expect(await quotes.siteOrganizationId(slug)).toBe(orgId);
    await expectDomainError(quotes.siteOrganizationId('nao-existe'), 'not_found');
  });

  it('valida nome, e-mail, WhatsApp, segmento, serviços e descrição', async () => {
    await expectDomainError(quotes.submit(orgId, { ...base, email: 'sem-arroba' }), 'validation');
    await expectDomainError(quotes.submit(orgId, { ...base, phone: '123' }), 'validation');
    await expectDomainError(quotes.submit(orgId, { ...base, segment: 'circo' }), 'validation');
    await expectDomainError(quotes.submit(orgId, { ...base, services: [] }), 'validation');
    await expectDomainError(quotes.submit(orgId, { ...base, services: ['figurino'] }), 'validation');
    await expectDomainError(quotes.submit(orgId, { ...base, description: 'curto' }), 'validation');
    await expectDomainError(quotes.submit(orgId, { ...base, neededBy: '20/12/2026' }), 'validation');
  });

  it('grava, cria o contato e avisa só as administradoras com telefone; reenvio não duplica', async () => {
    const r = await quotes.submit(orgId, base);
    expect(r.duplicate).toBe(false);
    const q = await quotes.get(orgId, r.id);
    expect(q).toMatchObject({ name: 'Marina Lopes', email: 'marina@exemplo.com', status: 'new', neededBy: '2026-12-20', services: ['costume', 'props'] });
    const contact = await db.contact.findUniqueOrThrow({ where: { id: q.contactId! } });
    expect(contact).toMatchObject({ name: 'Marina Lopes', phone: q.phone });

    const deliveries = await db.notificationDelivery.findMany({ where: { organizationId: orgId } });
    expect(deliveries.map((d) => d.recipient)).toEqual([ANA]);
    expect(deliveries[0]!.text).toContain('Novo pedido de orçamento pelo site');

    expect(await quotes.submit(orgId, base)).toEqual({ id: r.id, duplicate: true });
    expect(await db.quoteRequest.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await db.notificationDelivery.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('contato que já existe mantém o nome dado pela equipe', async () => {
    const phone = `554195${suffix}`;
    await db.contact.create({ data: { organizationId: orgId, phone, name: 'Marina (figurinista)' } });
    const r = await quotes.submit(orgId, { ...base, name: 'Marina', phone, description: 'Outro projeto: adereços para curta.' });
    const q = await quotes.get(orgId, r.id);
    expect((await db.contact.findUniqueOrThrow({ where: { id: q.contactId! } })).name).toBe('Marina (figurinista)');
  });

  it('equipe acompanha: lista por situação com contagem, muda a situação e anota', async () => {
    const { items, counts } = await quotes.list(orgId);
    expect(counts).toEqual({ new: 2, contacted: 0, approved: 0, archived: 0 });
    const updated = await quotes.update(orgId, items[0]!.id, { status: 'contacted', notes: 'Orçamento enviado por e-mail' }, actor);
    expect(updated).toMatchObject({ status: 'contacted', notes: 'Orçamento enviado por e-mail' });
    expect((await quotes.list(orgId, 'contacted')).items.map((i) => i.id)).toEqual([items[0]!.id]);
    expect((await quotes.list(orgId)).counts).toMatchObject({ new: 1, contacted: 1 });
    // Aprovado só ao virar projeto.
    await expectDomainError(quotes.update(orgId, items[0]!.id, { status: 'approved' }, actor), 'validation');
    await expectDomainError(quotes.get(orgId, 'nao-existe'), 'not_found');
  });

  it('promover a projeto: liga o projeto, aprova, não promove duas vezes; excluir o projeto devolve para "em conversa"', async () => {
    const { items } = await quotes.list(orgId, 'contacted');
    const q = items[0]!;
    const { project } = await projects.createFromWeb(orgId, { title: `Figurino - ${q.name}`, objective: q.description }, actor);
    const linked = await quotes.linkProject(orgId, q.id, project.id, actor);
    expect(linked).toMatchObject({ status: 'approved', projectId: project.id });
    expect((await projects.detail(orgId, project.id)).quoteRequest).toMatchObject({ id: q.id, name: q.name, phone: q.phone, neededBy: '2026-12-20' });
    await expectDomainError(quotes.assertPromotable(orgId, q.id), 'conflict');
    await expectDomainError(quotes.update(orgId, q.id, { status: 'archived' }, actor), 'conflict');

    await projects.deleteProject(orgId, project.id, actor);
    expect(await quotes.get(orgId, q.id)).toMatchObject({ status: 'contacted', projectId: null });
  });
});
