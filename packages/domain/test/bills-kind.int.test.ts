/**
 * Contas: tipo mensal (valor fixo + multa por atraso) ou pontual (uma data), e categorias da casa.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BillingService, DomainError, ExpenseCategoryService, inferUtility, NotificationService } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-13T08:00');
const billing = new BillingService(db);
const categories = new ExpenseCategoryService(db);
const BIA = `55114${String(Date.now()).slice(-8)}`;
let orgId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Contas', slug: `contas-${randomUUID()}` } })).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('categorias de gasto', () => {
  it('organização nova ganha Casa, Estoque e Manutenção; cria, edita e arquiva com ícone e cor', async () => {
    const initial = await categories.list(orgId);
    expect(initial.map((c) => [c.name, c.icon, c.color])).toEqual([
      ['Casa', 'casa', 'floresta'],
      ['Estoque', 'estoque', 'mostarda'],
      ['Manutenção', 'manutencao', 'terracota'],
    ]);
    const mkt = await categories.create(orgId, { name: 'Divulgação', icon: 'marketing', color: 'rosa' }, actor);
    await expectDomainError(categories.create(orgId, { name: 'Divulgação' }, actor), 'conflict');
    await expectDomainError(categories.create(orgId, { name: 'X', icon: 'foguete' }, actor), 'validation');
    await categories.update(orgId, mkt.id, { name: 'Marketing', active: false }, actor);
    expect((await categories.list(orgId)).map((c) => c.name)).toEqual(['Casa', 'Estoque', 'Manutenção']);
    expect((await categories.list(orgId, true)).map((c) => c.name)).toContain('Marketing');
  });
});

describe('tipo da conta', () => {
  it('pontual: uma ocorrência na data (mesmo daqui a meses), com categoria; mensal gera todo mês', async () => {
    const [, estoque] = await categories.list(orgId);
    const compra = await billing.createBill(
      orgId,
      { name: 'Compra de copos', kind: 'one_time', dueOn: '2027-02-10', dueDay: 1, estimatedAmountCents: 45000, expenseCategoryId: estoque!.id, startsOn: '2026-11-01' },
      actor,
      NOW,
    );
    expect(compra).toMatchObject({ kind: 'one_time', dueDay: 10, category: 'outros', expenseCategoryId: estoque!.id });
    const occs = await db.billOccurrence.findMany({ where: { recurringBillId: compra.id } });
    expect(occs.map((o) => [o.competence, o.dueDate.toISOString().slice(0, 10), o.expectedAmountCents])).toEqual([['2027-02', '2027-02-10', 45000]]);
    // O job mensal não cria outras.
    await billing.generateOccurrences(orgId, at('2027-02-01T08:00'));
    expect(await db.billOccurrence.count({ where: { recurringBillId: compra.id } })).toBe(1);

    const luz = await billing.createBill(orgId, { name: 'Conta de luz', dueDay: 20, estimatedAmountCents: 30000, startsOn: '2026-11-01' }, actor, NOW);
    expect(luz.category).toBe('energia');
    expect(await db.billOccurrence.count({ where: { recurringBillId: luz.id } })).toBe(2);
  });

  it('pontual: mudar a data move a ocorrência; data obrigatória', async () => {
    const b = await billing.createBill(orgId, { name: 'Conserto da porta', kind: 'one_time', dueOn: '2026-11-20', dueDay: 1, estimatedAmountCents: 20000, startsOn: '2026-11-01' }, actor, NOW);
    await billing.updateBill(orgId, b.id, { dueOn: '2026-12-02' }, actor, NOW);
    const occ = await db.billOccurrence.findFirstOrThrow({ where: { recurringBillId: b.id } });
    expect([occ.competence, occ.dueDate.toISOString().slice(0, 10)]).toEqual(['2026-12', '2026-12-02']);
    await expectDomainError(billing.createBill(orgId, { name: 'Sem data', kind: 'one_time', dueDay: 1, startsOn: '2026-11-01' }, actor, NOW), 'validation');
  });

  it('mensal com multa: atrasada sugere valor + multa e o aviso menciona a multa', async () => {
    const u = await db.user.create({ data: { name: 'Bia', phone: BIA } });
    await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'admin' } });
    const aluguel = await billing.createBill(
      orgId,
      { name: 'Aluguel', dueDay: 5, estimatedAmountCents: 250000, lateFeeCents: 5000, recipientPhones: [BIA], startsOn: '2026-11-01' },
      actor,
      NOW,
    );
    await new NotificationService(db).run(orgId, at('2026-11-13T09:00'));
    const notice = await db.notificationDelivery.findFirstOrThrow({ where: { organizationId: orgId, text: { contains: 'Aluguel está atrasada' } } });
    expect(notice.text).toContain('(+ multa de R$');
    const occ = (await billing.oldestOpenOccurrence(aluguel.id))!;
    expect(occ.status).toBe('overdue');
    const paid = await billing.registerPayment(orgId, occ.id, {}, actor, NOW);
    expect(paid).toMatchObject({ amountCents: 255000, occurrence: { status: 'paid' } });
    await expectDomainError(billing.createBill(orgId, { name: 'X', dueDay: 5, lateFeeCents: -1, startsOn: '2026-11-01' }, actor, NOW), 'validation');
    await db.user.deleteMany({ where: { phone: BIA } });
  });

  it('dedução do tipo de serviço pelo nome (WhatsApp entende "paguei a luz")', () => {
    expect(inferUtility('Conta de luz')).toBe('energia');
    expect(inferUtility('SABESP')).toBe('agua');
    expect(inferUtility('Compra de copos')).toBe('outros');
  });
});
