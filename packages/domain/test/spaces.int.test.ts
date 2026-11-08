/**
 * Cadastro de salas: situação (disponível / indisponível / alugada mensal), cor, ícone, fotos e horário padrão.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import type { InterpretCommandRequest, InterpretCommandResponse } from '@coxia/contracts';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BookingService, CommandService, DomainError, MAX_SPACE_PHOTOS, SpaceService } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-13T08:00');
const ADMIN = `55117${String(Date.now()).slice(-8)}`;

const spaces = new SpaceService(db);
const bookings = new BookingService(db);
let orgId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  return err as DomainError;
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Salas', slug: `salas-${randomUUID()}` } })).id;
  const user = await db.user.create({ data: { name: 'Ana', phone: ADMIN } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: 'owner' } });
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { phone: ADMIN } });
  await db.$disconnect();
});

describe('cadastro de salas', () => {
  it('sala nova: horário padrão seg–sáb 08–22, ordem ao fim da lista, cor e ícone escolhidos', async () => {
    const a = await spaces.create(orgId, { name: 'Estúdio', description: 'Piso de madeira, espelho', color: 'ameixa', icon: 'piano' }, actor);
    const b = await spaces.create(orgId, { name: 'Sala do Jardim' }, actor);
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    expect(a).toMatchObject({ status: 'available', color: 'ameixa', icon: 'piano', description: 'Piso de madeira, espelho' });
    expect(b).toMatchObject({ color: 'floresta', icon: 'porta' });

    const [listed] = (await spaces.list(orgId)).filter((s) => s.id === a.id);
    expect(listed!.availabilityRules.map((r) => [r.weekday, r.opensAt, r.closesAt])).toEqual(
      [1, 2, 3, 4, 5, 6].map((d) => [d, '08:00', '22:00']),
    );
    expect(listed!.photos).toEqual([]);

    // Recém-criada já aceita reserva.
    await bookings.create(orgId, { spaceId: a.id, startAt: at('2026-11-16T10:00'), endAt: at('2026-11-16T12:00') }, actor, NOW);
  });

  it('valor da hora de locação: salvo, alterado e validado', async () => {
    const s = await spaces.create(orgId, { name: 'Sala Preço', hourlyRateCents: 12000 }, actor);
    expect(s.hourlyRateCents).toBe(12000);
    expect((await spaces.update(orgId, s.id, { hourlyRateCents: 9000 }, actor, NOW)).hourlyRateCents).toBe(9000);
    expect((await spaces.update(orgId, s.id, { hourlyRateCents: null }, actor, NOW)).hourlyRateCents).toBeNull();
    await expectDomainError(spaces.update(orgId, s.id, { hourlyRateCents: 0 }, actor, NOW), 'validation');
    await expectDomainError(spaces.create(orgId, { name: 'Sala Preço 2', hourlyRateCents: 10.5 }, actor), 'validation');
  });

  it('nome repetido, cor e ícone fora da lista são recusados', async () => {
    await expectDomainError(spaces.create(orgId, { name: 'Estúdio' }, actor), 'conflict');
    await expectDomainError(spaces.create(orgId, { name: 'X', color: 'neon' as never }, actor), 'validation');
    await expectDomainError(spaces.create(orgId, { name: 'Y', icon: 'foguete' as never }, actor), 'validation');
    await expectDomainError(spaces.create(orgId, { name: '   ' }, actor), 'validation');
  });

  it('alugada mensal e indisponível não recebem reserva nem aparecem como livres; voltar a disponível libera', async () => {
    const s = await spaces.create(orgId, { name: 'Sala Azul' }, actor);
    await bookings.create(orgId, { spaceId: s.id, startAt: at('2026-11-18T14:00'), endAt: at('2026-11-18T16:00'), title: 'Aula' }, actor, NOW);

    // Ao deixar de estar disponível, as reservas futuras voltam para a administração decidir (nada é cancelado).
    const rented = await spaces.update(orgId, s.id, { status: 'monthly_rental' }, actor, NOW);
    expect(rented.futureOccurrences.map((o) => o.booking.title)).toEqual(['Aula']);
    expect(await db.bookingOccurrence.count({ where: { spaceId: s.id, status: { not: 'cancelled' } } })).toBe(1);

    const e1 = await expectDomainError(
      bookings.create(orgId, { spaceId: s.id, startAt: at('2026-11-19T14:00'), endAt: at('2026-11-19T16:00') }, actor, NOW),
      'validation',
    );
    expect(e1.message).toBe('A Sala Azul está alugada mensalmente e não recebe reservas avulsas');
    expect((await bookings.availability(orgId, '2026-11-19')).map((a) => a.space.id)).not.toContain(s.id);

    await spaces.update(orgId, s.id, { status: 'unavailable' }, actor, NOW);
    const e2 = await expectDomainError(
      bookings.create(orgId, { spaceId: s.id, startAt: at('2026-11-19T14:00'), endAt: at('2026-11-19T16:00') }, actor, NOW),
      'validation',
    );
    expect(e2.message).toBe('A Sala Azul está indisponível para reservas no momento');

    // Mover uma reserva para a sala fechada também é recusado.
    const other = await spaces.create(orgId, { name: 'Sala Verde' }, actor);
    const r = await bookings.create(orgId, { spaceId: other.id, startAt: at('2026-11-19T09:00'), endAt: at('2026-11-19T10:00') }, actor, NOW);
    await expectDomainError(
      bookings.updateOccurrence(orgId, r.occurrences[0]!.id, { startAt: at('2026-11-19T09:00'), endAt: at('2026-11-19T10:00'), spaceId: s.id }, actor),
      'validation',
    );

    const back = await spaces.update(orgId, s.id, { status: 'available' }, actor, NOW);
    expect(back.futureOccurrences).toEqual([]);
    await bookings.create(orgId, { spaceId: s.id, startAt: at('2026-11-19T14:00'), endAt: at('2026-11-19T16:00') }, actor, NOW);
  });

  it('série semanal não gera datas novas enquanto a sala está alugada e retoma depois', async () => {
    const s = await spaces.create(orgId, { name: 'Sala Série' }, actor);
    const r = await bookings.create(
      orgId,
      { spaceId: s.id, startAt: at('2026-11-14T10:00'), endAt: at('2026-11-14T11:00'), recurrence: { rule: 'FREQ=WEEKLY;BYDAY=SA' } },
      actor,
      NOW,
    );
    const initial = r.occurrences.length;
    await spaces.update(orgId, s.id, { status: 'monthly_rental' }, actor, NOW);
    const later = at('2027-02-15T08:00');
    await bookings.extendSeries(later);
    expect(await db.bookingOccurrence.count({ where: { bookingId: r.booking.id } })).toBe(initial);

    await spaces.update(orgId, s.id, { status: 'available' }, actor, NOW);
    await bookings.extendSeries(later);
    expect(await db.bookingOccurrence.count({ where: { bookingId: r.booking.id } })).toBeGreaterThan(initial);
  });

  it('reservas trazem cor e ícone da sala (agenda)', async () => {
    const s = await spaces.create(orgId, { name: 'Sala Cor', color: 'terracota', icon: 'microfone' }, actor);
    await bookings.create(orgId, { spaceId: s.id, startAt: at('2026-11-21T10:00'), endAt: at('2026-11-21T11:00') }, actor, NOW);
    const [occ] = await bookings.listOccurrences(orgId, at('2026-11-21T00:00'), at('2026-11-22T00:00'), { spaceId: s.id });
    expect(occ!.space).toMatchObject({ name: 'Sala Cor', color: 'terracota', icon: 'microfone' });
  });

  it(`fotos: até ${MAX_SPACE_PHOTOS} por sala, mesmo com envios paralelos; remoção devolve a chave`, async () => {
    const s = await spaces.create(orgId, { name: 'Sala Fotos' }, actor);
    const results = await Promise.allSettled(
      Array.from({ length: MAX_SPACE_PHOTOS + 3 }, (_, i) =>
        spaces.addPhoto(orgId, s.id, { storageKey: `${orgId}/spaces/${s.id}/${i}-${randomUUID()}.jpg`, contentType: 'image/jpeg', sizeBytes: 100 }, actor),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_SPACE_PHOTOS);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.every((r) => r.reason instanceof DomainError && r.reason.code === 'validation')).toBe(true);

    const [listed] = (await spaces.list(orgId)).filter((x) => x.id === s.id);
    expect(listed!.photos.map((p) => p.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const removed = await spaces.removePhoto(orgId, s.id, listed!.photos[0]!.id, actor);
    expect(removed.storageKey).toContain(`/spaces/${s.id}/`);
    await expectDomainError(spaces.getPhoto(orgId, s.id, removed.id), 'not_found');
    // Foto de outra organização não é encontrada.
    await expectDomainError(spaces.getPhoto(randomUUID(), s.id, listed!.photos[1]!.id), 'not_found');
  });
});

describe('WhatsApp e situação da sala', () => {
  it('pedido de reserva em sala alugada recebe o motivo', async () => {
    const s = await spaces.create(orgId, { name: 'Sala Alugada', aliases: ['alugada'] }, actor);
    await spaces.update(orgId, s.id, { status: 'monthly_rental' }, actor, NOW);
    const meta = { executionId: 'x', model: 'stub', promptVersion: 'commands@test', parserVersion: '1', inputTokens: 0, outputTokens: 0, latencyMs: 0 };
    const interpreter = {
      async interpret(_req: InterpretCommandRequest): Promise<InterpretCommandResponse> {
        return {
          command: {
            intent: 'booking.create',
            spaceHint: 'sala alugada',
            startAt: '2026-11-20T14:00:00-03:00',
            endAt: '2026-11-20T15:00:00-03:00',
            responsibleName: null,
            notes: null,
            recurrence: null,
          },
          confidence: 0.95,
          clarificationQuestion: null,
          meta,
        };
      },
    };
    const inst = await db.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID() } });
    const conv = await db.conversation.create({ data: { organizationId: orgId, instanceId: inst.id, externalChatId: ADMIN, isGroup: false } });
    const res = await new CommandService(db, interpreter).handle({
      organizationId: orgId,
      conversationId: conv.id,
      messageId: `m-${randomUUID()}`,
      senderPhone: ADMIN,
      text: 'Reserva a sala alugada sexta 14h',
      now: NOW,
    });
    expect(res.reply).toBe('A Sala Alugada está alugada mensalmente e não recebe reservas avulsas.');
  });
});
