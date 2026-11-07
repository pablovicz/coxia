/**
 * Golden/integração: regras críticas garantidas pelo PostgreSQL.
 * Requer DATABASE_URL apontando para um banco com as migrations aplicadas
 * (docker-compose.test.yml ou `docker compose up postgres` + `pnpm db:deploy`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimDueDeliveries,
  createPrismaClient,
  enqueueDelivery,
  isBookingOverlapError,
  isUniqueViolation,
  markDeliveryFailed,
} from '../src';

const prisma = createPrismaClient();
let orgId: string;
let salaGrande: string;
let salaPequena: string;
let bookingId: string;

const at = (hhmm: string) => new Date(`2026-11-13T${hhmm}:00-03:00`);

async function occurrence(spaceId: string, start: string, end: string, status: 'confirmed' | 'tentative' | 'cancelled' = 'confirmed') {
  return prisma.bookingOccurrence.create({
    data: { organizationId: orgId, bookingId, spaceId, startAt: at(start), endAt: at(end), status },
  });
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Org de teste', slug: `test-${randomUUID()}` },
  });
  orgId = org.id;
  salaGrande = (await prisma.space.create({ data: { organizationId: orgId, name: 'Sala Grande', slug: 'sala-grande' } })).id;
  salaPequena = (await prisma.space.create({ data: { organizationId: orgId, name: 'Sala Pequena', slug: 'sala-pequena' } })).id;
  bookingId = (await prisma.booking.create({ data: { organizationId: orgId, spaceId: salaGrande, title: 'Ensaio' } })).id;
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe('golden: reservas sem sobreposição (EXCLUDE USING gist)', () => {
  it('aceita a primeira reserva 14h–17h', async () => {
    await expect(occurrence(salaGrande, '14:00', '17:00')).resolves.toBeDefined();
  });

  it('rejeita sobreposição parcial na mesma sala', async () => {
    const err = await occurrence(salaGrande, '16:00', '18:00').catch((e: unknown) => e);
    expect(isBookingOverlapError(err)).toBe(true);
  });

  it('rejeita reserva provisória (tentative) sobreposta', async () => {
    const err = await occurrence(salaGrande, '15:00', '15:30', 'tentative').catch((e: unknown) => e);
    expect(isBookingOverlapError(err)).toBe(true);
  });

  it('aceita reserva encostada 17h–19h ([) semiaberto)', async () => {
    await expect(occurrence(salaGrande, '17:00', '19:00')).resolves.toBeDefined();
  });

  it('aceita o mesmo horário em outra sala', async () => {
    await expect(occurrence(salaPequena, '14:00', '17:00')).resolves.toBeDefined();
  });

  it('reserva cancelada não bloqueia o horário', async () => {
    const c = await occurrence(salaGrande, '20:00', '21:00');
    await prisma.bookingOccurrence.update({ where: { id: c.id }, data: { status: 'cancelled' } });
    await expect(occurrence(salaGrande, '20:00', '21:00')).resolves.toBeDefined();
  });

  it('rejeita intervalo invertido ou vazio (CHECK start_at < end_at)', async () => {
    await expect(occurrence(salaPequena, '10:00', '10:00')).rejects.toThrow();
    await expect(occurrence(salaPequena, '11:00', '10:00')).rejects.toThrow();
  });

  it('sob concorrência, exatamente uma de 10 reservas sobrepostas é aceita', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        prisma.$transaction(async (tx) =>
          tx.bookingOccurrence.create({
            data: {
              organizationId: orgId,
              bookingId,
              spaceId: salaPequena,
              startAt: at('08:00'),
              endAt: new Date(at('09:00').getTime() + i * 60_000),
            },
          }),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected.every((r) => isBookingOverlapError(r.reason))).toBe(true);
  });
});

describe('golden: contas mensais', () => {
  it('uma única ocorrência por conta e competência', async () => {
    const bill = await prisma.recurringBill.create({
      data: { organizationId: orgId, name: 'Aluguel', category: 'aluguel', dueDay: 31, startsOn: new Date('2026-01-01') },
    });
    const data = { organizationId: orgId, recurringBillId: bill.id, competence: '2026-02', dueDate: new Date('2026-02-28') };
    await prisma.billOccurrence.create({ data });
    const err = await prisma.billOccurrence.create({ data }).catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('rejeita dia de vencimento fora de 1..31 e competência malformada', async () => {
    await expect(
      prisma.recurringBill.create({
        data: { organizationId: orgId, name: 'X', category: 'outros', dueDay: 32, startsOn: new Date('2026-01-01') },
      }),
    ).rejects.toThrow();
    const bill = await prisma.recurringBill.create({
      data: { organizationId: orgId, name: 'Água', category: 'agua', dueDay: 10, startsOn: new Date('2026-01-01') },
    });
    await expect(
      prisma.billOccurrence.create({
        data: { organizationId: orgId, recurringBillId: bill.id, competence: '2026-13', dueDate: new Date('2026-12-10') },
      }),
    ).rejects.toThrow();
  });
});

describe('golden: despesas de projeto', () => {
  it('despesa "paid" exige comprovante ou confirmação', async () => {
    const project = await prisma.project.create({ data: { organizationId: orgId, title: 'XPO', status: 'active' } });
    const base = { organizationId: orgId, projectId: project.id, kind: 'expense' as const, description: 'Gráfica', amountCents: 48000 };
    await expect(prisma.projectExpense.create({ data: { ...base, status: 'paid' } })).rejects.toThrow();
    await expect(
      prisma.projectExpense.create({ data: { ...base, status: 'paid', confirmedByPhone: '5511977776666' } }),
    ).resolves.toBeDefined();
  });

  it('o mesmo evento extraído da mesma mensagem não é gravado duas vezes', async () => {
    const project = await prisma.project.findFirstOrThrow({ where: { organizationId: orgId } });
    const data = {
      organizationId: orgId,
      projectId: project.id,
      type: 'expense' as const,
      sourceMessageId: 'msg-1',
      fingerprint: 'abc',
      payload: { description: 'Gráfica' },
    };
    await prisma.projectEvent.create({ data });
    expect(isUniqueViolation(await prisma.projectEvent.create({ data }).catch((e: unknown) => e))).toBe(true);
  });
});

describe('outbox', () => {
  it('enqueue com a mesma chave não duplica', async () => {
    const key = `test:${randomUUID()}`;
    const a = await enqueueDelivery(prisma, { organizationId: orgId, recipient: '5511', text: 'oi', idempotencyKey: key });
    const b = await enqueueDelivery(prisma, { organizationId: orgId, recipient: '5511', text: 'oi de novo', idempotencyKey: key });
    expect(b.id).toBe(a.id);
    expect(b.text).toBe('oi');
  });

  it('dois workers concorrentes nunca reivindicam a mesma entrega', async () => {
    for (let i = 0; i < 20; i++) {
      await enqueueDelivery(prisma, {
        organizationId: orgId,
        recipient: '5511',
        text: `m${i}`,
        idempotencyKey: `claim:${randomUUID()}`,
        availableAt: new Date('2000-01-01'),
      });
    }
    const [a, b] = await Promise.all([claimDueDeliveries(prisma, 15), claimDueDeliveries(prisma, 15)]);
    const ids = [...a, ...b].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect([...a, ...b].every((d) => d.status === 'sending' && d.attempts === 1)).toBe(true);
  });

  it('falha não retentável vai direto para dead-letter', async () => {
    const d = await enqueueDelivery(prisma, { organizationId: orgId, recipient: '5511', text: 'x', idempotencyKey: `dead:${randomUUID()}` });
    expect(await markDeliveryFailed(prisma, { ...d, attempts: 1 }, 'número inválido', false)).toBe('dead');
    expect(await markDeliveryFailed(prisma, { ...d, attempts: 1 }, 'timeout', true)).toBe('failed');
    expect(await markDeliveryFailed(prisma, { ...d, attempts: 5 }, 'timeout', true)).toBe('dead');
  });
});
