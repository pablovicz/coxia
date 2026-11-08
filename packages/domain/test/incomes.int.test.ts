/**
 * Entradas de dinheiro: projeto, aluguel mensal de sala (gerado) e outras; recebimento e resumo do mês.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, DomainError, IncomeService, SpaceService } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const NOW = new Date('2026-11-13T08:00:00-03:00');
const incomes = new IncomeService(db);
const spaces = new SpaceService(db);
let orgId: string;
let projectId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  return err as DomainError;
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Entradas', slug: `entradas-${randomUUID()}` } })).id;
  projectId = (await db.project.create({ data: { organizationId: orgId, title: 'XPO', status: 'active' } })).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('entradas de projeto e outras', () => {
  it('entrada prevista do projeto; recebimento com valor e data; não recebe duas vezes', async () => {
    const inc = await incomes.create(orgId, { source: 'project', projectId, description: 'Patrocínio — 2ª parcela', amountCents: 500000, expectedOn: '2026-11-25', payerName: 'Lei Rouanet' }, actor);
    expect(inc).toMatchObject({ status: 'expected', project: { title: 'XPO' }, spaceId: null });

    const got = await incomes.receive(orgId, inc.id, { amountCents: 480000, receivedOn: '2026-11-24' }, actor, NOW);
    expect(got).toMatchObject({ status: 'received', receivedAmountCents: 480000 });
    expect(got.receivedOn?.toISOString().slice(0, 10)).toBe('2026-11-24');
    await expectDomainError(incomes.receive(orgId, inc.id, {}, actor, NOW), 'conflict');
    await expectDomainError(incomes.cancel(orgId, inc.id, actor), 'validation');
    expect((await incomes.listForProject(orgId, projectId)).map((i) => i.id)).toEqual([inc.id]);
  });

  it('recebimentos simultâneos da mesma entrada: só um vale', async () => {
    const inc = await incomes.create(orgId, { source: 'other', description: 'Bilheteria', amountCents: 120000, expectedOn: '2026-11-14' }, actor);
    const results = await Promise.allSettled([1, 2, 3].map(() => incomes.receive(orgId, inc.id, {}, actor, NOW)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('validações: projeto obrigatório na origem projeto, valor positivo, data e organização', async () => {
    await expectDomainError(incomes.create(orgId, { source: 'project', description: 'X', amountCents: 100, expectedOn: '2026-11-20' }, actor), 'validation');
    await expectDomainError(incomes.create(orgId, { source: 'other', description: 'X', amountCents: 0, expectedOn: '2026-11-20' }, actor), 'validation');
    await expectDomainError(incomes.create(orgId, { source: 'other', description: 'X', amountCents: 100, expectedOn: '20/11' }, actor), 'validation');
    await expectDomainError(incomes.create(orgId, { source: 'project', projectId: randomUUID(), description: 'X', amountCents: 100, expectedOn: '2026-11-20' }, actor), 'not_found');
  });
});

describe('aluguel mensal das salas', () => {
  let salaId: string;

  it('sala alugada gera a entrada do mês e do próximo, uma vez só', async () => {
    const sala = await spaces.create(orgId, { name: 'Ateliê', status: 'monthly_rental', rentAmountCents: 180000, rentDueDay: 10, tenantName: 'Coletivo Barro' }, actor);
    salaId = sala.id;
    await incomes.generateRentals(orgId, NOW);
    await incomes.generateRentals(orgId, NOW);
    const rents = await db.income.findMany({ where: { spaceId: salaId }, orderBy: { expectedOn: 'asc' } });
    expect(rents.map((r) => [r.competence, r.expectedOn.toISOString().slice(0, 10), r.amountCents, r.payerName, r.source])).toEqual([
      ['2026-11', '2026-11-10', 180000, 'Coletivo Barro', 'room_rental'],
      ['2026-12', '2026-12-10', 180000, 'Coletivo Barro', 'room_rental'],
    ]);
  });

  it('mudar o valor ajusta só os aluguéis futuros ainda previstos; o atrasado fica', async () => {
    await spaces.update(orgId, salaId, { rentAmountCents: 200000 }, actor, NOW);
    const rents = await db.income.findMany({ where: { spaceId: salaId }, orderBy: { expectedOn: 'asc' } });
    expect(rents.map((r) => r.amountCents)).toEqual([180000, 200000]);
  });

  it('sala deixa de ser alugada: aluguéis futuros cancelados, não gera mais', async () => {
    await spaces.update(orgId, salaId, { status: 'available' }, actor, NOW);
    await incomes.generateRentals(orgId, NOW);
    const rents = await db.income.findMany({ where: { spaceId: salaId }, orderBy: { expectedOn: 'asc' } });
    expect(rents.map((r) => r.status)).toEqual(['expected', 'cancelled']);
  });

  it('valor ou dia inválido é recusado', async () => {
    await expectDomainError(spaces.update(orgId, salaId, { rentAmountCents: -5 }, actor, NOW), 'validation');
    await expectDomainError(spaces.update(orgId, salaId, { rentDueDay: 40 }, actor, NOW), 'validation');
  });
});

describe('resumo e lista do mês', () => {
  it('previsto, recebido e atrasadas; a lista inclui atrasadas de meses anteriores', async () => {
    await incomes.create(orgId, { source: 'other', description: 'Oficina outubro', amountCents: 30000, expectedOn: '2026-10-20' }, actor);
    const summary = await incomes.summary(orgId, '2026-11', NOW);
    // Novembro: patrocínio recebido (480.000), bilheteria recebida (120.000), aluguel do Ateliê previsto (180.000).
    expect(summary).toMatchObject({ expectedCents: 780000, receivedCents: 600000, total: 3, received: 2 });
    // Atrasadas: aluguel de 10/11 e a oficina de outubro.
    expect(summary.overdue).toBe(2);

    const list = await incomes.list(orgId, '2026-11');
    expect(list.map((i) => i.description)).toEqual(['Oficina outubro', 'Aluguel Ateliê', 'Bilheteria', 'Patrocínio — 2ª parcela']);
    await expectDomainError(incomes.list(orgId, '2026-13'), 'validation');
  });
});
