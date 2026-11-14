/**
 * Contas: tipo mensal (valor fixo + multa por atraso) ou pontual (uma data), e categorias da casa.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BillingService, billLabel, DomainError, ExpenseCategoryService, FinanceService, howToPay, inferUtility, installmentOf, installmentsEnd, NotificationService } from '../src';

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

describe('parcelas e para quem pagar', () => {
  it('parcelada: gera só dentro das parcelas, numera e termina no mês da última', async () => {
    expect(installmentsEnd('2026-11-01', 3)).toBe('2027-01-31');
    expect(installmentsEnd('2026-12-01', 1)).toBe('2026-12-31');
    const b = await billing.createBill(
      orgId,
      { name: 'Equipamento de som', dueDay: 15, estimatedAmountCents: 50000, installments: 3, startsOn: '2026-12-10', payeeName: 'Loja do Som', paymentDetails: 'PIX 11.222.333/0001-44' },
      actor,
      NOW,
    );
    expect(b).toMatchObject({ installments: 3, payeeName: 'Loja do Som', paymentDetails: 'PIX 11.222.333/0001-44' });
    expect([b.startsOn.toISOString().slice(0, 10), b.endsOn!.toISOString().slice(0, 10)]).toEqual(['2026-12-01', '2027-02-28']);
    for (const month of ['2027-01', '2027-02', '2027-03', '2027-04']) await billing.generateOccurrences(orgId, at(`${month}-02T08:00`));
    const occs = await db.billOccurrence.findMany({ where: { recurringBillId: b.id }, orderBy: { competence: 'asc' } });
    expect(occs.map((o) => o.competence)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(occs.map((o) => installmentOf(b, o.competence))).toEqual([
      { number: 1, total: 3 },
      { number: 2, total: 3 },
      { number: 3, total: 3 },
    ]);

    // Menos parcelas: a que sobrou (gerada e não paga) é cancelada.
    await billing.updateBill(orgId, b.id, { installments: 2 }, actor, at('2027-01-05T08:00'));
    const after = await db.billOccurrence.findMany({ where: { recurringBillId: b.id }, orderBy: { competence: 'asc' } });
    expect(after.map((o) => [o.competence, o.status])).toEqual([
      ['2026-12', 'overdue'],
      ['2027-01', 'pending'],
      ['2027-02', 'cancelled'],
    ]);
    await expectDomainError(billing.createBill(orgId, { name: 'X', dueDay: 5, installments: 0, startsOn: '2026-11-01' }, actor, NOW), 'validation');
    await expectDomainError(
      billing.createBill(orgId, { name: 'Y', kind: 'one_time', dueOn: '2026-11-20', dueDay: 1, installments: 2, startsOn: '2026-11-01' }, actor, NOW),
      'validation',
    );
  });

  it('o aviso do vencimento diz a parcela, para quem pagar e como', async () => {
    expect(billLabel('Aluguel', { payeeName: 'Imobiliária Lopes', installment: { number: 3, total: 10 } })).toBe('Aluguel (parcela 3/10, para Imobiliária Lopes)');
    expect(billLabel('Internet', {})).toBe('Internet');
    expect(howToPay({ paymentMethod: 'pix', paymentDetails: 'chave 11.222.333/0001-44' })).toBe('PIX · chave 11.222.333/0001-44');
    expect(howToPay({ paymentMethod: 'boleto' })).toBe('Boleto');
    expect(howToPay({})).toBeNull();
    const u = await db.user.create({ data: { name: 'Caio', phone: `55117${String(Date.now()).slice(-8)}` } });
    await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'admin' } });
    await billing.createBill(
      orgId,
      { name: 'Reforma do palco', dueDay: 14, estimatedAmountCents: 120000, installments: 4, startsOn: '2026-11-01', payeeName: 'Marcenaria Silva', paymentDetails: 'PIX marcenaria@silva.com', recipientPhones: [u.phone!] },
      actor,
      NOW,
    );
    await new NotificationService(db).run(orgId, at('2026-11-13T09:00'));
    const notice = await db.notificationDelivery.findFirstOrThrow({ where: { organizationId: orgId, recipient: u.phone!, text: { contains: 'Reforma do palco' } } });
    expect(notice.text).toBe('A conta de Reforma do palco (parcela 1/4, para Marcenaria Silva) vence amanhã (14/11): R$ 1.200,00. Quando pagar, me mande o comprovante.\nComo pagar: PIX marcenaria@silva.com');
    await db.user.delete({ where: { id: u.id } });
  });
});

describe('próximas contas, detalhe da conta e visão do ano', () => {
  it('próximas 10 dias inclui as atrasadas; detalhe soma pago, saldo devedor e parcelas atrasadas', async () => {
    const org2 = (await db.organization.create({ data: { name: 'Casa Detalhe', slug: `det-${randomUUID()}` } })).id;
    try {
      const b = await billing.createBill(
        org2,
        { name: 'Mesa de som', dueDay: 10, estimatedAmountCents: 30000, lateFeeCents: 2000, installments: 4, startsOn: '2026-10-01', payeeName: 'Loja do Som' },
        { channel: 'web', userId: null },
        at('2026-10-02T08:00'),
      );
      await billing.generateOccurrences(org2, at('2026-11-05T08:00'));
      await billing.markOverdue(org2, at('2026-11-13T08:00'));
      const occs = await db.billOccurrence.findMany({ where: { recurringBillId: b.id }, orderBy: { competence: 'asc' } });
      expect(occs.map((o) => [o.competence, o.status])).toEqual([
        ['2026-10', 'overdue'],
        ['2026-11', 'overdue'],
        ['2026-12', 'pending'],
      ]);
      await billing.registerPayment(org2, occs[0]!.id, { amountCents: 32000 }, actor, at('2026-11-13T09:00'));

      const upcoming = await billing.upcoming(org2, 10, at('2026-11-13T09:00'));
      expect(upcoming.map((o) => o.competence)).toEqual(['2026-11']); // dez/10 está a mais de 10 dias

      const d = await billing.details(org2, b.id);
      expect(d).toMatchObject({
        paidCents: 32000,
        // nov e dez em aberto (2 × 300) + 1 parcela ainda não gerada (jan) × 300
        outstandingCents: 90000,
        installments: { total: 4, paid: 1, remaining: 3 },
        overdueCents: 32000,
      });
      expect(d.overdue).toEqual([
        { occurrenceId: occs[1]!.id, competence: '2026-11', dueDate: '2026-11-10', openCents: 30000, lateFeeCents: 2000, installment: { number: 2, total: 4 } },
      ]);
      expect(d.createdBy).toEqual({ name: null, channel: 'web' });
      expect(d.occurrences.map((o) => [o.competence, o.installment?.number])).toEqual([
        ['2026-10', 1],
        ['2026-11', 2],
        ['2026-12', 3],
      ]);

      const year = await new FinanceService(db).year(org2, 2026, at('2026-11-13T09:00'));
      expect(year.currentCompetence).toBe('2026-11');
      expect(year.months.find((m) => m.competence === '2026-10')).toMatchObject({ billsExpectedCents: 30000, billsPaidCents: 32000, billsOverdue: 0 });
      expect(year.months.find((m) => m.competence === '2026-11')).toMatchObject({ billsExpectedCents: 30000, billsPaidCents: 0, billsOverdue: 1 });
      expect(year.totals.billsExpectedCents).toBe(90000);
    } finally {
      await db.organization.delete({ where: { id: org2 } });
    }
  });
});
