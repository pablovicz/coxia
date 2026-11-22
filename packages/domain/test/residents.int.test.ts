/**
 * Residentes: cadastro ligado ao contato, situação pelos pagamentos (entradas), locações e programação
 * (reservas semanais), entrada e dias de pagamento; contato cadastrado à mão.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BookingService, ContactService, DomainError, IncomeService, normalizeInstagram, ResidentService, residentSituation } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-13T08:00');
const residents = new ResidentService(db);
const incomes = new IncomeService(db);
const suffix = String(Date.now()).slice(-6);
const PHONE = `551197${suffix}1`;
let orgId: string;
let spaceId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Residentes', slug: `res-${randomUUID()}` } })).id;
  spaceId = (await db.space.create({ data: { organizationId: orgId, name: 'Sala Média', slug: 'sala-media', hourlyRateCents: 8000 } })).id;
  await db.spaceAvailabilityRule.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ spaceId, weekday, opensAt: '08:00', closesAt: '22:00' })) });
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('situação pelos pagamentos', () => {
  it('atrasado > atenção (vence em até 5 dias) > regular > pendente', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(residentSituation([], '2026-11-13')).toBe('pending');
    expect(residentSituation([{ status: 'received', expectedOn: d('2026-11-05'), receivedOn: d('2026-11-05') }], '2026-11-13')).toBe('regular');
    expect(residentSituation([{ status: 'expected', expectedOn: d('2026-11-17'), receivedOn: null }], '2026-11-13')).toBe('attention');
    expect(residentSituation([{ status: 'expected', expectedOn: d('2026-11-30'), receivedOn: null }], '2026-11-13')).toBe('pending');
    expect(residentSituation([{ status: 'expected', expectedOn: d('2026-11-10'), receivedOn: null }], '2026-11-13')).toBe('overdue');
  });

  it('instagram aceita @usuario, usuario ou o link', () => {
    expect(normalizeInstagram('@xpo')).toBe('xpo');
    expect(normalizeInstagram('https://www.instagram.com/coletivo.lume/')).toBe('coletivo.lume');
    expect(normalizeInstagram('')).toBeNull();
    expect(() => normalizeInstagram('nome com espaço')).toThrow(DomainError);
  });
});

describe('residentes', () => {
  it('cadastro liga ao contato pelo WhatsApp; mesmo WhatsApp não vira dois residentes', async () => {
    const r = await residents.create(orgId, { name: 'Coletivo Lume', phone: PHONE.slice(2), instagram: '@coletivolume', email: 'oi@lume.art', paymentDay: 5 }, actor);
    expect(r).toMatchObject({ name: 'Coletivo Lume', instagram: 'coletivolume', paymentDay: 5, status: 'active' });
    expect(r.contact.phone).toBe(PHONE);
    expect((await db.contact.findUniqueOrThrow({ where: { id: r.contactId } })).kind).toBe('resident');
    await expectDomainError(residents.create(orgId, { name: 'Outro', phone: PHONE, email: 'outro@lume.art' }, actor), 'conflict');
    // E-mail é o login do workspace: obrigatório no cadastro.
    await expectDomainError(residents.create(orgId, { name: 'Sem e-mail', phone: `551196${suffix}9` }, actor), 'validation');
    await expectDomainError(residents.create(orgId, { name: 'X', phone: '123' }, actor), 'validation');
    await expectDomainError(residents.create(orgId, { name: 'X', phone: '11 98888-7777', email: 'sem-arroba' }, actor), 'validation');
  });

  it('detalhe: locações com a programação, pagamentos por mês, entrada, dias e situação', async () => {
    const [r] = await residents.list(orgId, NOW);
    // Reserva semanal (seg e qua, 19h–21h) com este residente como responsável.
    await new BookingService(db).create(
      orgId,
      { spaceId, title: 'Ensaio', contactId: r!.contactId, weekly: { startsOn: '2026-11-16', until: null, slots: [{ weekday: 1, start: '19:00', end: '21:00' }, { weekday: 3, start: '19:00', end: '21:00' }] } },
      actor,
      NOW,
    );
    const pay = async (amount: number, expectedOn: string, receivedOn?: string) => {
      const i = await incomes.create(orgId, { source: 'room_rental', description: 'Mensalidade', amountCents: amount, expectedOn, spaceId, contactId: r!.contactId }, actor);
      if (receivedOn) await incomes.receive(orgId, i.id, { receivedOn }, actor);
    };
    await pay(240000, '2026-09-05', '2026-09-05');
    await pay(260000, '2026-10-05', '2026-10-06');
    await pay(260000, '2026-11-15');

    const d = await residents.details(orgId, r!.id, NOW);
    expect(d.situation).toBe('attention');
    expect(d.rentals).toHaveLength(1);
    expect(d.rentals[0]!.space.name).toBe('Sala Média');
    expect(d.rentals[0]!.schedule.map((s) => [s.weekdays.join(','), s.start, s.end])).toEqual([['MO,WE', '19:00', '21:00']]);
    expect(d.payments.map((p) => [p.month, p.status])).toEqual([
      ['2026-11', 'expected'],
      ['2026-10', 'received'],
      ['2026-09', 'received'],
    ]);
    expect(d.firstPaymentMonth).toBe('2026-09');
    expect(d.paymentDays).toEqual({ agreed: 5, observed: [5, 6] });
    expect(d.totals).toEqual({ receivedCents: 500000, openCents: 260000 });

    const list = await residents.list(orgId, NOW);
    expect(list[0]).toMatchObject({ situation: 'attention', rooms: [{ id: spaceId, name: 'Sala Média' }] });
  });

  it('reserva semanal para um contato novo cria o cadastro de residente', async () => {
    const booking = await new BookingService(db).create(
      orgId,
      { spaceId, title: 'Aula', responsibleName: 'Bruna Dança', responsiblePhone: '11 96666-5555', weekly: { startsOn: '2026-11-17', until: null, slots: [{ weekday: 2, start: '10:00', end: '12:00' }] } },
      actor,
      NOW,
    );
    expect(booking).toBeTruthy();
    const all = await residents.list(orgId, NOW);
    expect(all.map((r) => r.name)).toContain('Bruna Dança');
  });

  it('desabilitar e trocar o WhatsApp (passa a ser outro contato)', async () => {
    const [r] = (await residents.list(orgId, NOW)).filter((x) => x.name === 'Coletivo Lume');
    const updated = await residents.update(orgId, r!.id, { status: 'disabled', phone: '11 95555-4444' }, actor);
    expect(updated.status).toBe('disabled');
    expect(updated.contact.phone).toBe('5511955554444');
  });
});

describe('contato cadastrado à mão', () => {
  it('cria com nome e WhatsApp; número repetido é conflito', async () => {
    const contacts = new ContactService(db);
    const c = await contacts.create(orgId, { name: 'Marina (patrocínio)', phone: '11 98888-0000', notes: 'Patrocínio da XPO' }, actor);
    expect(c).toMatchObject({ phone: '5511988880000', name: 'Marina (patrocínio)', notes: 'Patrocínio da XPO' });
    await expectDomainError(contacts.create(orgId, { name: 'De novo', phone: '+55 11 98888-0000' }, actor), 'conflict');
    await expectDomainError(contacts.create(orgId, { name: '', phone: '11 98888-1111' }, actor), 'validation');
  });
});
