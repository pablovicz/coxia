/**
 * Contratos de horas de residentes: concessões por ciclo (sem acumular), reservas pelo workspace
 * com saldo e conflito, cancelamento, check-in (link e QR), uso avulso, e-mails no outbox e eventos.
 * Relógio fixo: sábado, 21/11/2026 10:00 (America/Sao_Paulo). Ciclo no dia 1º, virada no dia 25.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  BookingService,
  type DomainEvent,
  DomainError,
  ResidentBookingService,
  ResidentContractService,
  ResidentService,
} from '../src';

const db = createPrismaClient();
const staff: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-21T10:00');
const events: DomainEvent[] = [];
const publisher = { publish: (e: DomainEvent) => events.push(e) };
const bookings = new BookingService(db, publisher);
const contracts = new ResidentContractService(db, publisher);
const residentBookings = new ResidentBookingService(db, bookings, contracts, publisher);
const residents = new ResidentService(db);
const suffix = String(Date.now()).slice(-6);
let orgId: string;
let spaceId: string;
let otherSpaceId: string;
let lumeId: string;
let xpoId: string;
let contractId: string;
let xpoContractId: string;
const lume: Actor = { channel: 'resident', residentAccountId: 'acc-lume' };
const xpo: Actor = { channel: 'resident', residentAccountId: 'acc-xpo' };

async function expectDomainError(p: Promise<unknown>, code: string, detailCode?: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (detailCode) expect((err as DomainError).details).toMatchObject({ code: detailCode });
  return err as DomainError;
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Kaju', slug: `contratos-${randomUUID()}` } })).id;
  spaceId = (await db.space.create({ data: { organizationId: orgId, name: 'Sala Média', slug: 'sala-media' } })).id;
  otherSpaceId = (await db.space.create({ data: { organizationId: orgId, name: 'Estúdio', slug: 'estudio' } })).id;
  for (const id of [spaceId, otherSpaceId]) {
    await db.spaceAvailabilityRule.createMany({ data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ spaceId: id, weekday, opensAt: '08:00', closesAt: '22:00' })) });
  }
  lumeId = (await residents.create(orgId, { name: 'Coletivo Lume', phone: `1197${suffix}1`, email: 'oi@lume.art' }, staff)).id;
  xpoId = (await residents.create(orgId, { name: 'Cia XPO', phone: `1197${suffix}2`, email: 'xpo@xpo.art' }, staff)).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('contrato', () => {
  it('valida os termos', async () => {
    const base = { spaceId, monthlyMinutes: 600, cycleDay: 1, bookingOpensDay: 25, startsOn: '2026-11-01' };
    await expectDomainError(contracts.create(orgId, lumeId, { ...base, monthlyMinutes: 45 }, staff, NOW), 'validation');
    await expectDomainError(contracts.create(orgId, lumeId, { ...base, cycleDay: 32 }, staff, NOW), 'validation');
    await expectDomainError(contracts.create(orgId, lumeId, { ...base, endsOn: '2026-10-01' }, staff, NOW), 'validation');
  });

  it('criar concede as horas do ciclo atual e gera a mensalidade prevista', async () => {
    events.length = 0;
    const c = await contracts.create(
      orgId,
      lumeId,
      { spaceId, monthlyMinutes: 10 * 60, monthlyAmountCents: 90000, paymentDueDay: 10, cycleDay: 1, bookingOpensDay: 25, startsOn: '2026-11-01' },
      staff,
      NOW,
    );
    contractId = c.id;
    const grants = await db.hourGrant.findMany({ where: { contractId } });
    expect(grants.map((g) => [g.cycle, g.minutes])).toEqual([['2026-11', 600]]);
    const incomes = await db.income.findMany({ where: { contractId }, orderBy: { competence: 'asc' } });
    expect(incomes.map((i) => [i.competence, i.amountCents, i.expectedOn.toISOString().slice(0, 10), i.status])).toEqual([
      ['2026-11', 90000, '2026-11-10', 'expected'],
      ['2026-12', 90000, '2026-12-10', 'expected'],
    ]);
    expect(events.some((e) => e.type === 'contract.changed' && e.residentId === lumeId)).toBe(true);
    xpoContractId = (await contracts.create(orgId, xpoId, { spaceId, monthlyMinutes: 4 * 60, cycleDay: 1, bookingOpensDay: 25, startsOn: '2026-11-01' }, staff, NOW)).id;
  });

  it('o job é idempotente e, na virada, concede o próximo ciclo', async () => {
    await contracts.runMaintenance(NOW);
    await contracts.runMaintenance(NOW);
    expect(await db.hourGrant.count({ where: { contractId } })).toBe(1);
    await contracts.runMaintenance(at('2026-11-25T00:30'));
    const grants = await db.hourGrant.findMany({ where: { contractId }, orderBy: { cycle: 'asc' } });
    expect(grants.map((g) => g.cycle)).toEqual(['2026-11', '2026-12']);
    expect(await db.income.count({ where: { contractId } })).toBe(2);
  });

  it('mudança de horas vale a partir do próximo ciclo; o atual fica', async () => {
    await contracts.update(orgId, contractId, { monthlyMinutes: 12 * 60, monthlyAmountCents: 100000 }, staff, at('2026-11-25T09:00'));
    const grants = await db.hourGrant.findMany({ where: { contractId }, orderBy: { cycle: 'asc' } });
    expect(grants.map((g) => [g.cycle, g.minutes])).toEqual([
      ['2026-11', 600],
      ['2026-12', 720],
    ]);
    const incomes = await db.income.findMany({ where: { contractId }, orderBy: { competence: 'asc' } });
    expect(incomes.map((i) => i.amountCents)).toEqual([90000, 100000]);
    // volta ao original para os próximos testes
    await contracts.update(orgId, contractId, { monthlyMinutes: 600 }, staff, at('2026-11-25T09:00'));
  });

  it('dia de renovação não muda depois que há saldo', async () => {
    await expectDomainError(contracts.update(orgId, contractId, { cycleDay: 5 }, staff, NOW), 'validation', 'cycle_day_locked');
  });
});

describe('reservas do residente', () => {
  it('reserva avulsa compromete as horas e enfileira o convite .ics', async () => {
    events.length = 0;
    const r = await residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-23T14:00'), endAt: at('2026-11-23T18:00') }, lume, NOW);
    expect(r.occurrences).toHaveLength(1);
    const balance = await contracts.balance(orgId, contractId, NOW);
    expect(balance.cycles[0]).toMatchObject({ cycle: '2026-11', reservedMinutes: 240, availableMinutes: 360 });
    const mail = await db.notificationDelivery.findFirst({ where: { idempotencyKey: `booking_request:${r.occurrences[0]!.id}:0` } });
    expect(mail).toMatchObject({ channel: 'email', recipient: 'oi@lume.art' });
    expect(mail!.payload).toMatchObject({ template: 'booking', method: 'REQUEST', spaceName: 'Sala Média' });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['booking.changed', 'hours.changed']));
  });

  it('regras do horário: blocos de 30 min, 1 h no mínimo, futuro, sala aberta', async () => {
    await expectDomainError(residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-24T14:15'), endAt: at('2026-11-24T16:00') }, lume, NOW), 'validation');
    await expectDomainError(residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-24T14:00'), endAt: at('2026-11-24T14:30') }, lume, NOW), 'validation');
    await expectDomainError(residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-21T08:00'), endAt: at('2026-11-21T09:00') }, lume, NOW), 'validation');
    const closed = await expectDomainError(residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-24T21:00'), endAt: at('2026-11-24T23:00') }, lume, NOW), 'conflict');
    expect((closed.details as { conflicts: Array<{ reason: string }> }).conflicts[0]!.reason).toBe('outside_hours');
  });

  it('antes da virada o próximo ciclo está fechado', async () => {
    await expectDomainError(residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-12-02T10:00'), endAt: at('2026-12-02T12:00') }, lume, NOW), 'validation', 'cycle_closed');
  });

  it('não reserva além do saldo do ciclo', async () => {
    const err = await expectDomainError(
      residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-26T08:00'), endAt: at('2026-11-26T14:30') }, lume, NOW),
      'validation',
      'insufficient_hours',
    );
    expect(err.details).toMatchObject({ shortfalls: [{ cycle: '2026-11', neededMinutes: 390, availableMinutes: 360 }] });
  });

  it('outro residente não reserva horário já ocupado', async () => {
    const err = await expectDomainError(residentBookings.book(orgId, xpoId, { contractId: xpoContractId, startAt: at('2026-11-23T15:00'), endAt: at('2026-11-23T17:00') }, xpo, NOW), 'conflict');
    expect((err.details as { conflicts: Array<{ reason: string }> }).conflicts[0]!.reason).toBe('overlap');
  });

  it('residente não usa contrato de outro nem vê reservas de outro', async () => {
    await expectDomainError(residentBookings.book(orgId, xpoId, { contractId, startAt: at('2026-11-24T10:00'), endAt: at('2026-11-24T11:00') }, xpo, NOW), 'not_found');
    const mine = await residentBookings.list(orgId, lumeId, at('2026-11-01T00:00'), at('2026-12-31T00:00'), NOW);
    await expectDomainError(residentBookings.cancelOccurrence(orgId, xpoId, mine[0]!.id, xpo, NOW), 'not_found');
    expect(await residentBookings.list(orgId, xpoId, at('2026-11-01T00:00'), at('2026-12-31T00:00'), NOW)).toEqual([]);
  });

  it('reservas simultâneas do mesmo residente que juntas estouram o saldo: só uma entra', async () => {
    // saldo do XPO: 4h; duas de 3h em horários diferentes, ao mesmo tempo
    const results = await Promise.allSettled([
      residentBookings.book(orgId, xpoId, { contractId: xpoContractId, startAt: at('2026-11-27T09:00'), endAt: at('2026-11-27T12:00') }, xpo, NOW),
      residentBookings.book(orgId, xpoId, { contractId: xpoContractId, startAt: at('2026-11-28T09:00'), endAt: at('2026-11-28T12:00') }, xpo, NOW),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as DomainError).details).toMatchObject({ code: 'insufficient_hours' });
  });

  it('cancelar antes do início devolve as horas e manda o cancelamento .ics', async () => {
    const r = await residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-24T10:00'), endAt: at('2026-11-24T12:00') }, lume, NOW);
    const id = r.occurrences[0]!.id;
    expect((await contracts.balance(orgId, contractId, NOW)).cycles[0]!.availableMinutes).toBe(240);
    await residentBookings.cancelOccurrence(orgId, lumeId, id, lume, NOW);
    expect((await contracts.balance(orgId, contractId, NOW)).cycles[0]!.availableMinutes).toBe(360);
    const cancel = await db.notificationDelivery.findFirst({ where: { idempotencyKey: `booking_cancel:${id}:1` } });
    expect(cancel!.payload).toMatchObject({ method: 'CANCEL', sequence: 1 });
  });

  it('semanal até o fim do ciclo, pulando conflitos', async () => {
    // XPO tem 1h sobrando no ciclo: libera mais horas por ajuste
    await contracts.adjust(orgId, xpoContractId, { minutes: 240, note: 'Cortesia' }, staff, NOW);
    const r = await residentBookings.book(orgId, xpoId, { contractId: xpoContractId, startAt: at('2026-11-22T10:00'), endAt: at('2026-11-22T11:00'), repeatWeekly: true }, xpo, NOW);
    // domingos 22 e 29/11 — o ciclo termina em 30/11
    expect(r.occurrences.map((o) => o.startAt.toISOString())).toEqual([at('2026-11-22T10:00').toISOString(), at('2026-11-29T10:00').toISOString()]);
    const series = await db.booking.findUniqueOrThrow({ where: { id: r.booking.id } });
    expect(series.seriesUntil!.toISOString().slice(0, 10)).toBe('2026-11-30');
  });
});

describe('check-in', () => {
  let occId: string;

  it('abre 15 min antes e vai até o fim; atrasado debita a reserva inteira', async () => {
    const list = await residentBookings.list(orgId, lumeId, at('2026-11-23T00:00'), at('2026-11-24T00:00'), NOW);
    occId = list[0]!.id;
    await expectDomainError(residentBookings.checkIn(orgId, lumeId, occId, 'email_link', lume, at('2026-11-23T13:44')), 'validation', 'too_early');
    const before = (await contracts.balance(orgId, contractId, at('2026-11-23T15:30'))).cycles[0]!.availableMinutes;
    const done = await residentBookings.checkIn(orgId, lumeId, occId, 'email_link', lume, at('2026-11-23T15:30'));
    expect(done).toMatchObject({ attendance: 'checked_in', checkInMethod: 'email_link' });
    const after = (await contracts.balance(orgId, contractId, at('2026-11-23T15:30'))).cycles[0]!.availableMinutes;
    expect(after).toBe(before);
    // repetir é inofensivo
    await residentBookings.checkIn(orgId, lumeId, occId, 'email_link', lume, at('2026-11-23T15:40'));
    await expectDomainError(residentBookings.cancelOccurrence(orgId, lumeId, occId, lume, at('2026-11-23T15:41')), 'validation', 'cannot_cancel');
  });

  it('depois do fim, sem check-in, não dá mais', async () => {
    const r = await residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-25T09:00'), endAt: at('2026-11-25T10:00') }, lume, NOW);
    await expectDomainError(residentBookings.checkIn(orgId, lumeId, r.occurrences[0]!.id, 'email_link', lume, at('2026-11-25T10:00')), 'validation', 'too_late');
  });

  it('QR da sala: reserva minha no horário → check-in pendente', async () => {
    const status = await residentBookings.roomStatus(orgId, lumeId, spaceId, at('2026-11-25T08:50'));
    expect(status.state).toBe('booking');
  });

  it('QR da sala: ocupada por outro residente → até quando', async () => {
    const status = await residentBookings.roomStatus(orgId, xpoId, spaceId, at('2026-11-23T15:00'));
    expect(status).toEqual({ state: 'occupied', until: at('2026-11-23T18:00') });
  });

  it('QR da sala sem contrato nela', async () => {
    expect(await residentBookings.roomStatus(orgId, xpoId, otherSpaceId, NOW)).toEqual({ state: 'no_contract' });
  });

  it('QR da sala livre: uso avulso limitado pelo saldo e pelo fechamento, já com check-in e sem convite', async () => {
    const t = at('2026-11-23T19:07');
    const status = await residentBookings.roomStatus(orgId, xpoId, spaceId, t);
    // XPO: 4h + 4h de ajuste − 3h − 2×1h = 3h; a sala fecha às 22h (2h53 → 2h30)
    expect(status).toMatchObject({ state: 'walk_in', availableMinutes: 180, maxMinutes: 150 });
    await expectDomainError(residentBookings.walkIn(orgId, xpoId, spaceId, 180, xpo, t), 'validation', 'too_long');
    const done = await residentBookings.walkIn(orgId, xpoId, spaceId, 60, xpo, t);
    expect(done).toMatchObject({ attendance: 'checked_in', checkInMethod: 'room_qr', minutes: 60 });
    expect(await db.notificationDelivery.count({ where: { idempotencyKey: { startsWith: `booking_request:${done.id}` } } })).toBe(0);
  });

  it('a equipe registra check-in pelo painel', async () => {
    const r = await residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-26T09:00'), endAt: at('2026-11-26T10:00') }, lume, NOW);
    const done = await residentBookings.checkIn(orgId, null, r.occurrences[0]!.id, 'staff', staff, at('2026-11-26T09:20'));
    expect(done.checkInMethod).toBe('staff');
  });
});

describe('encerramento', () => {
  it('encerrar cancela as reservas e mensalidades previstas depois do fim', async () => {
    const r = await residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-28T15:00'), endAt: at('2026-11-28T16:00') }, lume, NOW);
    await contracts.end(orgId, contractId, '2026-11-27', staff, NOW);
    const occ = await db.bookingOccurrence.findUniqueOrThrow({ where: { id: r.occurrences[0]!.id } });
    expect(occ.status).toBe('cancelled');
    const dec = await db.income.findFirstOrThrow({ where: { contractId, competence: '2026-12' } });
    expect(dec.status).toBe('cancelled');
    await expectDomainError(residentBookings.book(orgId, lumeId, { contractId, startAt: at('2026-11-28T17:00'), endAt: at('2026-11-28T18:00') }, lume, NOW), 'validation', 'cycle_closed');
  });
});
