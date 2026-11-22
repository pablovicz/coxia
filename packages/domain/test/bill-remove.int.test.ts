/**
 * Remover o vencimento de um mês (cobrança errada, ex.: aluguel que só começa em dezembro).
 * Relógio fixo: 22/11/2026.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BillingService, DomainError } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-22T10:00');
const billing = new BillingService(db);
let orgId: string;

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Kaju', slug: `remover-${randomUUID()}` } })).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('remover vencimento', () => {
  it('some das telas, não volta no gerador nem ao reativar a conta, e não avisa', async () => {
    const aluguel = await billing.createBill(orgId, { name: 'Aluguel', dueDay: 5, isVariableAmount: true, startsOn: '2026-11-01' }, actor, NOW);
    const nov = await db.billOccurrence.findFirstOrThrow({ where: { recurringBillId: aluguel.id, competence: '2026-11' } });

    await billing.removeOccurrence(orgId, nov.id, actor, NOW);
    expect((await billing.listOccurrences(orgId, '2026-11')).map((o) => o.id)).not.toContain(nov.id);
    expect((await billing.details(orgId, aluguel.id)).occurrences.map((o) => o.competence)).toEqual(['2026-12']);
    expect(await billing.listOpen(orgId)).not.toContainEqual(expect.objectContaining({ id: nov.id }));

    await billing.generateOccurrences(orgId, NOW);
    expect(await db.billOccurrence.count({ where: { recurringBillId: aluguel.id, competence: '2026-11' } })).toBe(1);

    await billing.suspendBill(orgId, aluguel.id, actor, NOW);
    await billing.reactivateBill(orgId, aluguel.id, actor, NOW);
    expect((await db.billOccurrence.findUniqueOrThrow({ where: { id: nov.id } })).status).toBe('cancelled');
    expect((await billing.details(orgId, aluguel.id)).occurrences.map((o) => [o.competence, o.status])).toEqual([['2026-12', 'pending']]);

    // removido de novo: não encontrado
    const again = await billing.removeOccurrence(orgId, nov.id, actor, NOW).catch((e: unknown) => e);
    expect((again as DomainError).code).toBe('not_found');
  });

  it('com pagamento registrado não remove', async () => {
    const luz = await billing.createBill(orgId, { name: 'Luz', dueDay: 20, estimatedAmountCents: 30000, startsOn: '2026-11-01' }, actor, NOW);
    const occ = await db.billOccurrence.findFirstOrThrow({ where: { recurringBillId: luz.id, competence: '2026-11' } });
    await billing.registerPayment(orgId, occ.id, { amountCents: 10000, paidOn: '2026-11-20' }, actor, NOW);
    const err = await billing.removeOccurrence(orgId, occ.id, actor, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).details).toMatchObject({ code: 'has_payments' });
  });
});
