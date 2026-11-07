/**
 * Etapa 4 — concorrência com PostgreSQL real. Cada teste dispara operações em paralelo e verifica
 * o invariante de negócio, não só a ausência de erro.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BillingService, BookingService, CommandService, DomainError, NotificationService, ProjectService } from '../src';

// Pool maior que o padrão: o que se testa são as regras, não a fila de conexões.
const db = createPrismaClient(`${process.env.DATABASE_URL}${process.env.DATABASE_URL?.includes('?') ? '&' : '?'}connection_limit=20&pool_timeout=30`);
const billing = new BillingService(db);
const actor: Actor = { channel: 'web' };
const PHONE = `55115${String(Date.now()).slice(-8)}`;
let orgId: string;

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Concorrência', slug: `cc-${randomUUID()}` } })).id;
  const u = await db.user.create({ data: { name: 'Ana', phone: PHONE } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'owner', receivesMorningBriefing: true } });
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { phone: PHONE } });
  await db.$disconnect();
});

async function newBill(name: string, amount = 100_000) {
  const bill = await db.recurringBill.create({
    data: { organizationId: orgId, name, category: 'outros', dueDay: 10, estimatedAmountCents: amount, startsOn: new Date('2026-01-01') },
  });
  await billing.generateOccurrences(orgId, new Date('2026-11-01T12:00:00Z'));
  return db.billOccurrence.findFirstOrThrow({ where: { recurringBillId: bill.id, competence: '2026-11' } });
}

describe('golden: concorrência', () => {
  it('pagamentos parciais simultâneos na mesma conta somam todos (sem atualização perdida)', async () => {
    const occ = await newBill('Aluguel concorrente');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => billing.registerPayment(orgId, occ.id, { amountCents: 10_000 }, actor)),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const after = await db.billOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
    expect(after.paidAmountCents).toBe(50_000);
    expect(after.status).toBe('partially_paid');
    expect(await db.paymentAttachment.count({ where: { billOccurrenceId: occ.id } })).toBe(5);
  });

  it('quitação simultânea: só um pagamento total é aceito', async () => {
    const occ = await newBill('Água concorrente', 9_000);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => billing.registerPayment(orgId, occ.id, { amountCents: null }, actor)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(DomainError);
      expect((r.reason as DomainError).code).toBe('conflict');
    }
    const after = await db.billOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
    expect([after.paidAmountCents, after.status]).toEqual([9_000, 'paid']);
  });

  it('o mesmo comprovante enviado ao mesmo tempo para contas diferentes quita só uma', async () => {
    const a = await newBill('Internet concorrente', 15_000);
    const b = await newBill('Telefone concorrente', 15_000);
    const proof = { sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'), storageKey: 'x' };
    const results = await Promise.allSettled([
      billing.registerPayment(orgId, a.id, { amountCents: 15_000, proof }, actor),
      billing.registerPayment(orgId, b.id, { amountCents: 15_000, proof }, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.paymentAttachment.count({ where: { organizationId: orgId, sha256: proof.sha256 } })).toBe(1);
  });

  it('"SIM" repetido em paralelo executa a ação uma única vez', async () => {
    const space = await db.space.create({ data: { organizationId: orgId, name: 'Sala C', slug: `sc-${randomUUID()}` } });
    const created = await new BookingService(db).create(
      orgId,
      { spaceId: space.id, startAt: new Date('2027-01-05T13:00:00Z'), endAt: new Date('2027-01-05T15:00:00Z') },
      actor,
      new Date('2026-11-09T12:00:00Z'),
    );
    const occ = created.occurrences[0]!;
    const instance = await db.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID() } });
    const conv = await db.conversation.create({ data: { organizationId: orgId, instanceId: instance.id, externalChatId: PHONE, isGroup: false } });
    await db.pendingAction.create({
      data: {
        organizationId: orgId,
        conversationId: conv.id,
        requestedByPhone: PHONE,
        kind: 'booking.cancel_occurrence',
        payload: { occurrenceId: occ.id },
        summary: 'Sala C',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const commands = new CommandService(db, { interpret: async () => { throw new Error('não deve interpretar "sim"'); } });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => commands.handle({ organizationId: orgId, conversationId: conv.id, messageId: `m${i}`, senderPhone: PHONE, text: 'sim' })),
    );
    expect(results.filter((r) => r.action === 'booking_cancelled')).toHaveLength(1);
    expect(results.filter((r) => r.action === 'pending_already_resolved')).toHaveLength(4);
    expect(await db.auditEvent.count({ where: { organizationId: orgId, action: 'booking.cancel_occurrence' } })).toBe(1);
  });

  it('várias réplicas planejando notificações ao mesmo tempo geram cada aviso uma vez', async () => {
    const notifications = new NotificationService(db);
    const now = new Date('2026-11-09T11:05:00Z'); // 08:05 em São Paulo
    await Promise.all(Array.from({ length: 4 }, () => notifications.run(orgId, now)));
    const briefings = await db.notificationDelivery.findMany({ where: { organizationId: orgId, idempotencyKey: { startsWith: `${orgId}:morning_briefing:2026-11-09` } } });
    expect(briefings).toHaveLength(1);
  });

  it('validações simultâneas do mesmo lançamento: só a primeira passa (validar só vale para "proposto")', async () => {
    const projects = new ProjectService(db);
    const p = await db.project.create({ data: { organizationId: orgId, title: 'Paralelo', status: 'active' } });
    const e = await db.projectExpense.create({ data: { organizationId: orgId, projectId: p.id, kind: 'expense', description: 'Som', amountCents: 1_000, status: 'proposed' } });
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => projects.reviewExpense(orgId, p.id, e.id, 'confirm', actor)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) expect((r.reason as DomainError).code).toBe('validation');
    expect(await db.auditEvent.count({ where: { entityId: e.id } })).toBe(1);
  });

  it('encerrar o mesmo projeto duas vezes ao mesmo tempo gera um único relatório', async () => {
    const projects = new ProjectService(db);
    const p = await db.project.create({ data: { organizationId: orgId, title: 'Duplo', status: 'active' } });
    const results = await Promise.allSettled([projects.close(orgId, p.id, actor), projects.close(orgId, p.id, actor), projects.close(orgId, p.id, actor)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.projectSummary.count({ where: { projectId: p.id, kind: 'closing' } })).toBe(1);
  });

  it('geração de ocorrências em paralelo não duplica competências', async () => {
    await db.recurringBill.create({
      data: { organizationId: orgId, name: 'Gás paralelo', category: 'outros', dueDay: 31, estimatedAmountCents: 5_000, startsOn: new Date('2026-01-01') },
    });
    await Promise.all(Array.from({ length: 4 }, () => billing.generateOccurrences(orgId, new Date('2026-11-02T12:00:00Z'))));
    const rows = await db.billOccurrence.groupBy({ by: ['recurringBillId', 'competence'], where: { organizationId: orgId }, _count: true });
    expect(rows.every((r) => r._count === 1)).toBe(true);
  });
});
