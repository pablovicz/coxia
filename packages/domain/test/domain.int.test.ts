/**
 * Golden/integração das regras da Etapa 2 com PostgreSQL real.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import type { InterpretCommandRequest, InterpretCommandResponse } from '@coxia/contracts';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  BillingService,
  BookingService,
  CommandService,
  DomainError,
  NotificationService,
  ReminderService,
  SpaceService,
} from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-13T08:00');
const ADMIN = `55119${String(Date.now()).slice(-8)}`;
const OTHER = `55118${String(Date.now()).slice(-8)}`;

let orgId: string;
let grande: string;
let pequena: string;
const bookings = new BookingService(db);
const billing = new BillingService(db);
const spacesSvc = new SpaceService(db);

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  return err as DomainError;
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: 'Casa Teste', slug: `dom-${randomUUID()}` } });
  orgId = org.id;
  const rules = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '22:00' }));
  grande = (await spacesSvc.create(orgId, { name: 'Sala Grande', aliases: ['salão'], sortOrder: 1 }, actor)).id;
  pequena = (await spacesSvc.create(orgId, { name: 'Sala Pequena', sortOrder: 3 }, actor)).id;
  await spacesSvc.setAvailability(orgId, grande, rules, actor);
  await spacesSvc.setAvailability(orgId, pequena, rules, actor);
  const user = await db.user.create({ data: { name: 'Ana', phone: ADMIN } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: 'owner', receivesMorningBriefing: true, canManageProjects: true } });
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { phone: ADMIN } });
  await db.$disconnect();
});

describe('golden: agenda', () => {
  it('reserva válida e conflito com quem ocupa', async () => {
    const r = await bookings.create(
      orgId,
      { spaceId: grande, startAt: at('2026-11-20T14:00'), endAt: at('2026-11-20T17:00'), title: 'Ensaio', responsibleName: 'Micaela' },
      actor,
      NOW,
    );
    expect(r.occurrences).toHaveLength(1);

    const err = await expectDomainError(
      bookings.create(orgId, { spaceId: grande, startAt: at('2026-11-20T16:00'), endAt: at('2026-11-20T18:00') }, actor, NOW),
      'conflict',
    );
    const conflict = (err.details as { conflicts: Array<{ reason: string; with: { responsibleName: string } }> }).conflicts[0]!;
    expect(conflict.reason).toBe('overlap');
    expect(conflict.with.responsibleName).toBe('Micaela');

    // Encostada é permitida; em outra sala também.
    await bookings.create(orgId, { spaceId: grande, startAt: at('2026-11-20T17:00'), endAt: at('2026-11-20T19:00') }, actor, NOW);
    await bookings.create(orgId, { spaceId: pequena, startAt: at('2026-11-20T14:00'), endAt: at('2026-11-20T17:00') }, actor, NOW);
  });

  it('fora do funcionamento e intervalo inválido', async () => {
    const e = await expectDomainError(
      bookings.create(orgId, { spaceId: grande, startAt: at('2026-11-22T10:00'), endAt: at('2026-11-22T12:00') }, actor, NOW),
      'conflict',
    );
    expect((e.details as { conflicts: Array<{ reason: string }> }).conflicts[0]!.reason).toBe('outside_hours');
    await expectDomainError(
      bookings.create(orgId, { spaceId: grande, startAt: at('2026-11-20T12:00'), endAt: at('2026-11-20T12:00') }, actor, NOW),
      'validation',
    );
  });

  it('cancelamento libera o horário', async () => {
    const r = await bookings.create(orgId, { spaceId: pequena, startAt: at('2026-11-23T09:00'), endAt: at('2026-11-23T10:00') }, actor, NOW);
    await bookings.cancelOccurrence(orgId, r.occurrences[0]!.id, actor);
    await expect(
      bookings.create(orgId, { spaceId: pequena, startAt: at('2026-11-23T09:00'), endAt: at('2026-11-23T10:00') }, actor, NOW),
    ).resolves.toBeDefined();
    const audits = await db.auditEvent.count({ where: { organizationId: orgId, action: 'booking.cancel_occurrence' } });
    expect(audits).toBe(1);
  });

  it('recorrência com bloqueio: modo fail rejeita, modo skip cria e relata', async () => {
    const block = await spacesSvc.addBlock(orgId, pequena, { startAt: at('2026-12-01T00:00'), endAt: at('2026-12-02T00:00'), reason: 'Manutenção' }, actor);
    expect(block.conflictingOccurrences).toEqual([]);
    const input = {
      spaceId: pequena,
      startAt: at('2026-11-17T19:00'),
      endAt: at('2026-11-17T21:00'),
      title: 'Dança',
      recurrence: { rule: 'FREQ=WEEKLY;BYDAY=TU', until: '2026-12-15' },
    };
    const e = await expectDomainError(bookings.create(orgId, input, actor, NOW), 'conflict');
    expect((e.details as { conflicts: Array<{ reason: string }> }).conflicts.map((c) => c.reason)).toEqual(['blocked']);

    const r = await bookings.create(orgId, { ...input, onConflict: 'skip' }, actor, NOW);
    expect(r.occurrences.map((o) => o.startAt.toISOString().slice(0, 10))).toEqual(['2026-11-17', '2026-11-24', '2026-12-08', '2026-12-15']);
    expect(r.skipped.map((s) => s.startAt.toISOString())).toEqual(['2026-12-01T22:00:00.000Z']);
    expect(r.booking.localStartTime).toBe('19:00');
  });

  it('alterar uma ocorrência isolada vs. a série inteira', async () => {
    const r = await bookings.create(
      orgId,
      { spaceId: grande, startAt: at('2026-11-18T10:00'), endAt: at('2026-11-18T11:00'), recurrence: { rule: 'FREQ=WEEKLY;BYDAY=WE', until: '2026-12-09' } },
      actor,
      NOW,
    );
    expect(r.occurrences).toHaveLength(4);
    const [first, second] = r.occurrences;

    // Isolada: segunda data passa para 15h e vira exceção.
    const moved = await bookings.updateOccurrence(orgId, second!.id, { startAt: at('2026-11-25T15:00'), endAt: at('2026-11-25T16:00') }, actor);
    expect(moved.isException).toBe(true);

    // Ocupa 09h–10h em 02/12 para gerar conflito na mudança da série.
    await bookings.create(orgId, { spaceId: grande, startAt: at('2026-12-02T09:00'), endAt: at('2026-12-02T10:00') }, actor, NOW);

    await expectDomainError(
      bookings.updateSeries(orgId, r.booking.id, { localStartTime: '09:00', localEndTime: '10:30', fromDate: '2026-11-18' }, actor),
      'conflict',
    );
    const res = await bookings.updateSeries(
      orgId,
      r.booking.id,
      { localStartTime: '09:00', localEndTime: '10:30', fromDate: '2026-11-18', onConflict: 'skip' },
      actor,
    );
    expect(res.updated).toBe(2); // 18/11 e 09/12; 25/11 é exceção; 02/12 conflita
    expect(res.skipped.map((s) => s.startAt.toISOString())).toEqual(['2026-12-02T12:00:00.000Z']);

    const after = await db.bookingOccurrence.findMany({ where: { bookingId: r.booking.id }, orderBy: { startAt: 'asc' } });
    expect(after.map((o) => o.startAt.toISOString())).toEqual([
      '2026-11-18T12:00:00.000Z',
      '2026-11-25T18:00:00.000Z',
      '2026-12-02T13:00:00.000Z',
      '2026-12-09T12:00:00.000Z',
    ]);
    expect(first!.id).toBe(after[0]!.id);
  });

  it('cancelar série a partir de uma data', async () => {
    const r = await bookings.create(
      orgId,
      { spaceId: grande, startAt: at('2026-11-19T19:00'), endAt: at('2026-11-19T20:00'), recurrence: { rule: 'FREQ=WEEKLY;BYDAY=TH', until: '2026-12-10' } },
      actor,
      NOW,
    );
    const res = await bookings.cancelSeries(orgId, r.booking.id, '2026-12-03', actor);
    expect(res.cancelled).toBe(2);
    const active = await db.bookingOccurrence.count({ where: { bookingId: r.booking.id, status: { not: 'cancelled' } } });
    expect(active).toBe(2);
  });

  it('séries sem fim são estendidas até o horizonte, de forma idempotente', async () => {
    const r = await bookings.create(
      orgId,
      { spaceId: pequena, startAt: at('2026-11-14T10:00'), endAt: at('2026-11-14T11:00'), recurrence: { rule: 'FREQ=WEEKLY;BYDAY=SA' } },
      actor,
      NOW,
    );
    const initial = r.occurrences.length;
    const later = at('2027-01-15T08:00');
    await bookings.extendSeries(later);
    const afterFirst = await db.bookingOccurrence.count({ where: { bookingId: r.booking.id } });
    expect(afterFirst).toBeGreaterThan(initial);
    await bookings.extendSeries(later);
    expect(await db.bookingOccurrence.count({ where: { bookingId: r.booking.id } })).toBe(afterFirst);
  });

  it('disponibilidade e busca por horário', async () => {
    const [g] = await bookings.availability(orgId, '2026-11-20', { spaceId: grande, window: { start: at('2026-11-20T13:00'), end: at('2026-11-20T18:00') } });
    expect(g!.free).toEqual([{ start: at('2026-11-20T13:00'), end: at('2026-11-20T14:00') }]);
    const found = await bookings.findAround(orgId, at('2026-11-20T14:00'));
    expect(found.map((o) => o.space.name).sort()).toEqual(['Sala Grande', 'Sala Pequena']);
  });
});

describe('golden: contas mensais', () => {
  it('dia 31 em fevereiro, geração idempotente', async () => {
    const feb = at('2027-02-10T08:00');
    const bill = await billing.createBill(orgId, { name: 'Aluguel', category: 'aluguel', dueDay: 31, estimatedAmountCents: 250000, startsOn: '2027-01-01' }, actor, feb);
    const occ = await db.billOccurrence.findMany({ where: { recurringBillId: bill.id }, orderBy: { competence: 'asc' } });
    expect(occ.map((o) => [o.competence, o.dueDate.toISOString().slice(0, 10)])).toEqual([
      ['2027-02', '2027-02-28'],
      ['2027-03', '2027-03-31'],
    ]);
    expect(await billing.generateOccurrences(orgId, feb)).toBe(0);
    expect(await db.billOccurrence.count({ where: { recurringBillId: bill.id } })).toBe(2);
  });

  it('pagamento parcial, completo, repetido e comprovante duplicado', async () => {
    const bill = await billing.createBill(orgId, { name: 'Internet', category: 'internet', dueDay: 20, estimatedAmountCents: 14990, startsOn: '2026-11-01' }, actor, NOW);
    const occ = (await billing.oldestOpenOccurrence(bill.id))!;
    expect(occ.competence).toBe('2026-11');

    const partial = await billing.registerPayment(orgId, occ.id, { amountCents: 5000, proof: { sha256: 'a'.repeat(64), storageKey: 'k1' } }, actor, NOW);
    expect(partial.occurrence.status).toBe('partially_paid');
    expect(partial.remainingCents).toBe(9990);

    await expectDomainError(
      billing.registerPayment(orgId, occ.id, { proof: { sha256: 'a'.repeat(64), storageKey: 'k2' } }, actor, NOW),
      'conflict',
    );
    const full = await billing.registerPayment(orgId, occ.id, {}, actor, NOW);
    expect(full.occurrence.status).toBe('paid');
    expect(full.amountCents).toBe(9990);
    const again = await expectDomainError(billing.registerPayment(orgId, occ.id, { amountCents: 100 }, actor, NOW), 'conflict');
    expect((again.details as { code: string }).code).toBe('already_paid');
  });

  it('valor variável exige valor no primeiro pagamento', async () => {
    const bill = await billing.createBill(orgId, { name: 'Água', category: 'agua', dueDay: 15, isVariableAmount: true, startsOn: '2026-11-01' }, actor, NOW);
    const occ = (await billing.oldestOpenOccurrence(bill.id))!;
    await expectDomainError(billing.registerPayment(orgId, occ.id, {}, actor, NOW), 'validation');
    const r = await billing.registerPayment(orgId, occ.id, { amountCents: 8740 }, actor, NOW);
    expect(r.occurrence).toMatchObject({ status: 'paid', expectedAmountCents: 8740 });
  });

  it('mudança de vencimento e valor só afeta ocorrências em aberto', async () => {
    const bill = await billing.createBill(orgId, { name: 'Telefone', category: 'telefone', dueDay: 20, estimatedAmountCents: 9000, startsOn: '2026-11-01' }, actor, NOW);
    const nov = (await billing.oldestOpenOccurrence(bill.id))!;
    await billing.registerPayment(orgId, nov.id, {}, actor, NOW);
    await billing.updateBill(orgId, bill.id, { dueDay: 25, estimatedAmountCents: 9900 }, actor, NOW);
    const all = await db.billOccurrence.findMany({ where: { recurringBillId: bill.id }, orderBy: { competence: 'asc' } });
    expect(all.map((o) => [o.competence, o.dueDate.toISOString().slice(0, 10), o.expectedAmountCents, o.status])).toEqual([
      ['2026-11', '2026-11-20', 9000, 'paid'],
      ['2026-12', '2026-12-25', 9900, 'pending'],
    ]);
  });

  it('conta suspensa não gera nem avisa; reativação reabre', async () => {
    const bill = await billing.createBill(orgId, { name: 'Gás', category: 'outros', dueDay: 25, estimatedAmountCents: 5000, startsOn: '2026-11-01' }, actor, NOW);
    await billing.suspendBill(orgId, bill.id, actor, NOW);
    const statuses = await db.billOccurrence.findMany({ where: { recurringBillId: bill.id }, select: { status: true } });
    expect(statuses.every((s) => s.status === 'cancelled')).toBe(true);
    expect(await billing.generateOccurrences(orgId, at('2027-01-05T08:00'))).toBeGreaterThanOrEqual(0);
    expect(await db.billOccurrence.count({ where: { recurringBillId: bill.id, competence: '2027-01' } })).toBe(0);
    await billing.reactivateBill(orgId, bill.id, actor, NOW);
    expect(await db.billOccurrence.count({ where: { recurringBillId: bill.id, status: 'pending' } })).toBe(2);
  });

  it('resumo mensal', async () => {
    const s = await billing.summary(orgId, '2026-11');
    expect(s.total).toBeGreaterThan(0);
    expect(s.paid + s.pending + s.overdue).toBe(s.total);
  });
});

describe('golden: avisos', () => {
  let orgN: string;
  const notifications = new NotificationService(db);
  const bill = async (name: string, dueDay: number, recipients: string[]) =>
    new BillingService(db).createBill(orgN, { name, category: 'outros', dueDay, estimatedAmountCents: 10000, recipientPhones: recipients, startsOn: '2026-11-01' }, actor, NOW);

  beforeAll(async () => {
    const org = await db.organization.create({ data: { name: 'Casa Avisos', slug: `notif-${randomUUID()}` } });
    orgN = org.id;
    const u = await db.user.create({ data: { name: 'Bia', phone: `55117${String(Date.now()).slice(-8)}` } });
    await db.organizationMember.create({ data: { organizationId: orgN, userId: u.id, role: 'admin', receivesMorningBriefing: true } });
  });
  afterAll(async () => {
    await db.organization.delete({ where: { id: orgN } }).catch(() => undefined);
  });

  it('D-1 sai uma única vez; conta paga não é avisada; briefing diário único', async () => {
    const energia = await bill('Energia', 14, [OTHER]);
    const paidEarly = await bill('Internet', 14, [OTHER]);
    const occPaid = (await billing.oldestOpenOccurrence(paidEarly.id))!;
    await billing.registerPayment(orgN, occPaid.id, {}, actor, NOW); // pagamento antecipado

    expect(await notifications.run(orgN, at('2026-11-13T07:30'))).toEqual([]);
    const first = await notifications.run(orgN, NOW);
    const occEnergia = (await billing.oldestOpenOccurrence(energia.id))!;
    expect(first.sort()).toEqual([`bill_day_before:${occEnergia.id}`, 'morning_briefing:2026-11-13'].sort());
    expect(await notifications.run(orgN, at('2026-11-13T08:01'))).toEqual([]);

    const deliveries = await db.notificationDelivery.findMany({ where: { organizationId: orgN }, orderBy: { createdAt: 'asc' } });
    expect(deliveries.map((d) => d.recipient)).toContain(OTHER);
    expect(deliveries.filter((d) => d.text.includes('Internet'))).toEqual([]);
    const briefing = deliveries.find((d) => d.text.startsWith('Bom dia!'))!;
    expect(briefing.text).toContain('Vence amanhã: Energia');
  });

  it('atrasada: marca status e reavisa só depois do intervalo', async () => {
    const aluguel = await bill('Aluguel', 5, [OTHER]);
    const occ = (await billing.oldestOpenOccurrence(aluguel.id))!;
    const d1 = await notifications.run(orgN, at('2026-11-13T09:00'));
    expect(d1).toContain(`bill_overdue:${occ.id}:2026-11-13`);
    expect((await db.billOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).status).toBe('overdue');
    expect(await notifications.run(orgN, at('2026-11-15T09:00'))).not.toContain(`bill_overdue:${occ.id}:2026-11-15`);
    expect(await notifications.run(orgN, at('2026-11-16T09:00'))).toContain(`bill_overdue:${occ.id}:2026-11-16`);
  });

  it('lembrete recorrente dispara e agenda o próximo', async () => {
    const r = await new ReminderService(db).create(
      orgN,
      { title: 'Regar as plantas', dueAt: at('2026-11-13T07:00'), recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR', recipientPhones: [OTHER] },
      actor,
    );
    const sent = await notifications.run(orgN, at('2026-11-13T07:05'));
    expect(sent).toEqual([`reminder:${r.id}:2026-11-13T10:00:00.000Z`]);
    const after = await db.reminder.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.nextRunAt?.toISOString()).toBe('2026-11-20T10:00:00.000Z');
  });
});

describe('golden: comandos pelo WhatsApp', () => {
  let conversationId: string;
  let seq = 0;
  const responses = new Map<string, InterpretCommandResponse['command']>();
  const meta = { executionId: 'x', model: 'stub', promptVersion: 'commands@test', parserVersion: '1', inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const interpreter = {
    async interpret(req: InterpretCommandRequest): Promise<InterpretCommandResponse> {
      const command = responses.get(req.text) ?? { intent: 'none' as const };
      return { command, confidence: 0.95, clarificationQuestion: null, meta };
    },
  };
  const svc = new CommandService(db, interpreter);
  const send = (text: string, phone = ADMIN, attachment?: { id: string; sha256: string; storageKey: string }) =>
    svc.handle({ organizationId: orgId, conversationId, messageId: `m${++seq}-${randomUUID()}`, senderPhone: phone, text, attachment, now: NOW });

  beforeAll(async () => {
    const inst = await db.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID() } });
    conversationId = (await db.conversation.create({ data: { organizationId: orgId, instanceId: inst.id, externalChatId: ADMIN, isGroup: false } })).id;
  });

  it('reserva pela conversa e relata conflito', async () => {
    responses.set('Reserva a sala grande na sexta 27 das 14h às 17h para a Micaela', {
      intent: 'booking.create',
      spaceHint: 'sala grande',
      startAt: '2026-11-27T14:00:00-03:00',
      endAt: '2026-11-27T17:00:00-03:00',
      responsibleName: 'Micaela',
      notes: null,
      recurrence: null,
    });
    const ok = await send('Reserva a sala grande na sexta 27 das 14h às 17h para a Micaela');
    expect(ok.reply).toBe('Reservado: Sala Grande, sex, 27/11, 14h–17h para Micaela.');
    const again = await send('Reserva a sala grande na sexta 27 das 14h às 17h para a Micaela');
    expect(again.reply).toBe('Não consegui reservar: já existe uma reserva (Micaela) das 14h–17h.');
  });

  it('cancelamento exige SIM de quem pediu', async () => {
    responses.set('Cancela a reserva das 14h do dia 27', { intent: 'booking.cancel', spaceHint: null, around: '2026-11-27T14:00:00-03:00' });
    const ask = await send('Cancela a reserva das 14h do dia 27');
    expect(ask.reply).toBe('Cancelar a reserva Sala Grande, sex, 27/11, 14h–17h (Micaela)? Responda SIM para confirmar.');

    const intruder = await send('sim', OTHER);
    expect(intruder.action).not.toBe('booking_cancelled');

    const yes = await send('SIM');
    expect(yes.reply).toBe('Cancelada: Sala Grande, sex, 27/11, 14h–17h (Micaela).');
    const twice = await send('sim');
    expect(twice.action).not.toBe('booking_cancelled');
    expect(await db.bookingOccurrence.count({ where: { organizationId: orgId, startAt: at('2026-11-27T14:00'), status: 'cancelled' } })).toBe(1);
  });

  it('conta paga com comprovante; comprovante repetido é recusado', async () => {
    await billing.createBill(orgId, { name: 'Energia elétrica', category: 'energia', dueDay: 18, estimatedAmountCents: 31000, startsOn: '2026-11-01' }, actor, NOW);
    responses.set('Paguei a luz', { intent: 'bill.mark_paid', billHint: 'luz', amountCents: null, paidOn: '2026-11-13' });
    const proof = { id: 'att1', sha256: 'b'.repeat(64), storageKey: 'org/x/proof.jpg' };
    const paid = await send('Paguei a luz', ADMIN, proof);
    expect(paid.reply).toBe('Anotado: Energia elétrica de novembro de 2026 paga (R$ 310,00). Comprovante guardado.');
    const dup = await send('Paguei a luz', ADMIN, proof);
    expect(dup.reply).toBe('Este comprovante já foi registrado para Energia elétrica (2026-11).');
  });

  it('disponibilidade e ajuda', async () => {
    responses.set('Quais salas estão livres sexta 20 à tarde?', {
      intent: 'booking.check_availability',
      spaceHint: null,
      from: '2026-11-20T13:00:00-03:00',
      to: '2026-11-20T18:00:00-03:00',
    });
    const r = await send('Quais salas estão livres sexta 20 à tarde?');
    expect(r.reply).toBe('Disponibilidade em sex, 20/11, 13h–18h:\n• Sala Grande: livre 13h–14h\n• Sala Pequena: livre 13h–14h, 17h–18h');
    expect((await send('bom dia!')).action).toBe('help');
    expect(await db.aiExecution.count({ where: { organizationId: orgId, operation: 'interpret_command' } })).toBeGreaterThan(0);
  });
});
