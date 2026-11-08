/**
 * Reserva semanal em vários dias com horário por dia, valor da hora (da sala ou com desconto)
 * e contato obrigatório (painel e WhatsApp). Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import type { InterpretCommandResponse } from '@coxia/contracts';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BookingService, CommandService, DomainError, SpaceService } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-13T08:00');
const ADMIN = `55115${String(Date.now()).slice(-8)}`;
const bookings = new BookingService(db);
const spaces = new SpaceService(db);
let orgId: string;
let salaId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  return err as DomainError;
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Reservas', slug: `reservas-${randomUUID()}` } })).id;
  salaId = (await spaces.create(orgId, { name: 'Sala Grande', aliases: ['grande'], hourlyRateCents: 8000 }, actor)).id;
  const u = await db.user.create({ data: { name: 'Ana Admin', phone: ADMIN } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'owner' } });
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { phone: ADMIN } });
  await db.$disconnect();
});

describe('reserva semanal com horário por dia', () => {
  it('seg e qua 14h–17h, sex 9h–12h: duas séries no mesmo grupo, datas certas, contato criado', async () => {
    const r = await bookings.create(
      orgId,
      {
        spaceId: salaId,
        weekly: {
          startsOn: '2026-11-16',
          until: '2026-11-30',
          slots: [
            { weekday: 1, start: '14:00', end: '17:00' },
            { weekday: 3, start: '14:00', end: '17:00' },
            { weekday: 5, start: '09:00', end: '12:00' },
          ],
        },
        title: 'Aulas de dança',
        responsibleName: 'Coletivo Lume',
        responsiblePhone: '(11) 98765-1111',
      },
      actor,
      NOW,
    );
    expect(r.bookings).toHaveLength(2);
    expect(new Set(r.bookings.map((b) => b.groupId)).size).toBe(1);
    expect(r.bookings[0]!.groupId).not.toBeNull();
    expect(r.bookings.map((b) => [b.recurrenceRule, b.localStartTime])).toEqual([
      ['FREQ=WEEKLY;BYDAY=MO,WE', '14:00'],
      ['FREQ=WEEKLY;BYDAY=FR', '09:00'],
    ]);
    const local = r.occurrences.map((o) => `${o.startAt.toISOString().slice(0, 10)} ${o.startAt.toISOString().slice(11, 16)}`);
    // 16/11 seg, 18 qua, 20 sex, 23, 25, 27, 30 (UTC = local + 3h).
    expect(local).toEqual([
      '2026-11-16 17:00',
      '2026-11-18 17:00',
      '2026-11-20 12:00',
      '2026-11-23 17:00',
      '2026-11-25 17:00',
      '2026-11-27 12:00',
      '2026-11-30 17:00',
    ]);
    // Contato novo nos Contatos; reserva com nome, telefone e o valor da hora da sala.
    const contact = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: orgId, phone: '5511987651111' } } });
    expect(contact.name).toBe('Coletivo Lume');
    expect(r.bookings.every((b) => b.contactId === contact.id && b.responsiblePhone === '5511987651111' && b.hourlyRateCents === 8000)).toBe(true);
  });

  it('conflito em um dos dias: modo fail não cria nada; modo skip cria o resto', async () => {
    const slots = [
      { weekday: 1, start: '15:00', end: '16:00' }, // bate com a série de seg 14h–17h
      { weekday: 2, start: '10:00', end: '11:00' },
    ];
    const before = await db.booking.count({ where: { organizationId: orgId } });
    await expectDomainError(
      bookings.create(orgId, { spaceId: salaId, weekly: { startsOn: '2026-11-16', until: '2026-11-24', slots }, responsibleName: 'X', responsiblePhone: '11911112222' }, actor, NOW),
      'conflict',
    );
    expect(await db.booking.count({ where: { organizationId: orgId } })).toBe(before);
    const r = await bookings.create(
      orgId,
      { spaceId: salaId, weekly: { startsOn: '2026-11-16', until: '2026-11-24', slots }, responsibleName: 'X', responsiblePhone: '11911112222', onConflict: 'skip' },
      actor,
      NOW,
    );
    expect(r.skipped).toHaveLength(2);
    expect(r.occurrences.map((o) => o.startAt.toISOString().slice(0, 10))).toEqual(['2026-11-17', '2026-11-24']);
  });

  it('valor da hora com desconto fica na reserva; validações de dias e horários', async () => {
    const r = await bookings.create(
      orgId,
      { spaceId: salaId, startAt: at('2026-11-21T10:00'), endAt: at('2026-11-21T12:00'), responsibleName: 'Bia', responsiblePhone: '11922223333', hourlyRateCents: 6000 },
      actor,
      NOW,
    );
    expect(r.booking.hourlyRateCents).toBe(6000);
    expect(r.occurrences[0]!.booking.hourlyRateCents).toBe(6000);
    await expectDomainError(bookings.create(orgId, { spaceId: salaId, startAt: at('2026-11-21T13:00'), endAt: at('2026-11-21T14:00'), hourlyRateCents: 0 }, actor, NOW), 'validation');
    await expectDomainError(
      bookings.create(orgId, { spaceId: salaId, weekly: { startsOn: '2026-11-16', slots: [{ weekday: 2, start: '10:00', end: '09:00' }] } }, actor, NOW),
      'validation',
    );
    await expectDomainError(
      bookings.create(
        orgId,
        { spaceId: salaId, weekly: { startsOn: '2026-11-16', slots: [{ weekday: 2, start: '10:00', end: '11:00' }, { weekday: 2, start: '12:00', end: '13:00' }] } },
        actor,
        NOW,
      ),
      'validation',
    );
    await expectDomainError(bookings.create(orgId, { spaceId: salaId, weekly: { startsOn: '2026-11-16', slots: [] } }, actor, NOW), 'validation');
  });

  it('cancelar "toda a reserva" encerra todos os dias do grupo', async () => {
    const r = await bookings.create(
      orgId,
      {
        spaceId: salaId,
        weekly: { startsOn: '2026-12-07', until: '2026-12-31', slots: [{ weekday: 2, start: '18:00', end: '19:00' }, { weekday: 4, start: '20:00', end: '21:00' }] },
        responsibleName: 'Grupo de teatro',
        responsiblePhone: '11933334444',
      },
      actor,
      NOW,
    );
    await bookings.cancelSeries(orgId, r.bookings[0]!.id, '2026-12-15', actor, { wholeGroup: true });
    const left = await db.bookingOccurrence.findMany({ where: { bookingId: { in: r.bookings.map((b) => b.id) }, status: { not: 'cancelled' } }, orderBy: { startAt: 'asc' } });
    expect(left.map((o) => o.startAt.toISOString().slice(0, 10))).toEqual(['2026-12-08', '2026-12-10']);
  });
});

describe('contato da reserva pelo WhatsApp', () => {
  const meta = { executionId: 'x', model: 'stub', promptVersion: 'commands@test', parserVersion: '1', inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const command = (responsibleName: string | null, day: string): InterpretCommandResponse => ({
    command: { intent: 'booking.create', spaceHint: 'grande', startAt: `${day}T10:00:00-03:00`, endAt: `${day}T11:00:00-03:00`, responsibleName, notes: null, recurrence: null },
    confidence: 0.95,
    clarificationQuestion: null,
    meta,
  });
  let conversationId: string;
  const send = (text: string, res: InterpretCommandResponse) =>
    new CommandService(db, { interpret: async () => res }).handle({
      organizationId: orgId,
      conversationId,
      messageId: `m-${randomUUID()}`,
      senderPhone: ADMIN,
      text,
      now: NOW,
    });

  beforeAll(async () => {
    const inst = await db.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID() } });
    conversationId = (await db.conversation.create({ data: { organizationId: orgId, instanceId: inst.id, externalChatId: ADMIN, isGroup: false } })).id;
  });

  it('nome desconhecido sem telefone: a Coxia pede o número e não reserva', async () => {
    const res = await send('Reserva a grande dia 23 às 10h para o Zeca', command('Zeca', '2026-11-24'));
    expect(res.action).toBe('clarify_contact');
    expect(res.reply).toContain('preciso do telefone de Zeca');
  });

  it('contato já cadastrado pelo nome; telefone na mensagem; sem nome = quem pediu', async () => {
    const byName = await send('Reserva a grande dia 25 às 10h para o Coletivo Lume', command('Coletivo Lume', '2026-11-25'));
    expect(byName.action).toBe('booking_created');
    const b1 = await db.booking.findFirstOrThrow({ where: { organizationId: orgId, responsibleName: 'Coletivo Lume', localStartTime: null }, orderBy: { createdAt: 'desc' } });
    expect(b1.responsiblePhone).toBe('5511987651111');

    const typed = await send('Reserva a grande dia 26 às 10h para o Zeca, 11 97777-0000', command('Zeca', '2026-11-26'));
    expect(typed.action).toBe('booking_created');
    expect(await db.contact.findFirst({ where: { organizationId: orgId, phone: '5511977770000', name: 'Zeca' } })).not.toBeNull();

    const mine = await send('Reserva a grande dia 28 às 10h', command(null, '2026-11-28'));
    expect(mine.action).toBe('booking_created');
    const b3 = await db.booking.findFirstOrThrow({ where: { organizationId: orgId, responsiblePhone: ADMIN } });
    expect(b3.responsibleName).toBe('Ana Admin');
  });
});
