/**
 * Lembretes por tipo (geral, ligar, mandar mensagem), automáticos das contas e conta de valor variável.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, BillingService, DomainError, NotificationService, ReminderService, reminderText } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-13T08:00');
const TEAM = `55116${String(Date.now()).slice(-8)}`;
const reminders = new ReminderService(db);
const billing = new BillingService(db);
let orgId: string;
let carlaId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  return err as DomainError;
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Lembretes', slug: `lemb-${randomUUID()}` } })).id;
  const u = await db.user.create({ data: { name: 'Bia Souza', phone: TEAM } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'staff' } });
  carlaId = (
    await db.contact.create({ data: { organizationId: orgId, phone: '5511987650002', name: 'Carla (iluminação)', whatsappName: 'Carla Mendes', searchName: 'carla' } })
  ).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { phone: TEAM } });
  await db.$disconnect();
});

describe('lembretes por tipo', () => {
  it('"ligar para" um contato: título automático e telefone no aviso', async () => {
    const r = await reminders.create(orgId, { type: 'call', contactId: carlaId, dueAt: at('2026-11-13T14:00'), recipientPhones: [`+${TEAM}`, TEAM] }, actor);
    expect(r).toMatchObject({ type: 'call', title: 'Ligar para Carla (iluminação)', contactId: carlaId, recipientPhones: [TEAM] });

    const sent = await new NotificationService(db).run(orgId, at('2026-11-13T14:00'));
    expect(sent).toContain(`reminder:${r.id}:${at('2026-11-13T14:00').toISOString()}`);
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { organizationId: orgId, recipient: TEAM, text: { startsWith: '⏰' } } });
    expect(delivery.text).toBe('⏰ Lembrete: Ligar para Carla (iluminação)\nLigar para: Carla (iluminação) · +55 11 98765-0002');
    // Único: desativa depois de enviar.
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).active).toBe(false);
  });

  it('"mandar mensagem" para alguém fora dos contatos, com link do WhatsApp', async () => {
    const r = await reminders.create(
      orgId,
      { type: 'message', personName: 'Seu Zé do som', personPhone: '(11) 3333-4444', message: 'Confirmar a mesa de som', dueAt: at('2026-11-14T10:00'), recipientPhones: [TEAM] },
      actor,
    );
    expect(r).toMatchObject({ title: 'Mandar mensagem para Seu Zé do som', personPhone: '551133334444' });
    expect(
      reminderText({ type: 'message', title: r.title, message: r.message, person: { name: 'Seu Zé do som', phone: '551133334444' } }),
    ).toBe('⏰ Lembrete: Mandar mensagem para Seu Zé do som\nMandar mensagem para: Seu Zé do som · +55 11 3333-4444\nhttps://wa.me/551133334444\nConfirmar a mesa de som');
  });

  it('ligar/mandar mensagem exige a pessoa; contato de outra organização e telefone inválido são recusados', async () => {
    await expectDomainError(reminders.create(orgId, { type: 'call', dueAt: NOW, recipientPhones: [TEAM] }, actor), 'validation');
    await expectDomainError(reminders.create(orgId, { type: 'call', contactId: randomUUID(), dueAt: NOW, recipientPhones: [TEAM] }, actor), 'not_found');
    await expectDomainError(reminders.create(orgId, { type: 'message', personName: 'X', personPhone: '123', dueAt: NOW, recipientPhones: [TEAM] }, actor), 'validation');
    await expectDomainError(reminders.create(orgId, { title: '  ', dueAt: NOW, recipientPhones: [TEAM] }, actor), 'validation');
    await expectDomainError(reminders.create(orgId, { title: 'Sem destino', dueAt: NOW, recipientPhones: ['abc'] }, actor), 'validation');
  });

  it('todo dia útil: próxima execução pula o fim de semana', async () => {
    const r = await reminders.create(
      orgId,
      { title: 'Abrir a casa', dueAt: at('2026-11-13T07:30'), recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', recipientPhones: [TEAM] },
      actor,
    );
    await new NotificationService(db).run(orgId, at('2026-11-13T07:31'));
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).nextRunAt).toEqual(at('2026-11-16T07:30'));
  });

  it('a lista traz o contato do lembrete', async () => {
    const list = await reminders.list(orgId);
    expect(list.find((r) => r.type === 'call')!.contact).toMatchObject({ name: 'Carla (iluminação)', phone: '5511987650002' });
  });
});

describe('lembretes automáticos das contas', () => {
  it('cada conta ativa aparece com a próxima em aberto e quem recebe; conta paga passa para o mês seguinte', async () => {
    const internet = await billing.createBill(orgId, { name: 'Internet', category: 'internet', dueDay: 20, estimatedAmountCents: 14990, recipientPhones: [TEAM], startsOn: '2026-11-01' }, actor, NOW);
    const agua = await billing.createBill(orgId, { name: 'Água', category: 'agua', dueDay: 15, isVariableAmount: true, estimatedAmountCents: 9000, startsOn: '2026-11-01' }, actor, NOW);
    await billing.generateOccurrences(orgId, NOW);

    let auto = await reminders.automaticFromBills(orgId);
    expect(auto.map((a) => [a.name, a.next?.dueDate])).toEqual([
      ['Água', '2026-11-15'],
      ['Internet', '2026-11-20'],
    ]);
    expect(auto.find((a) => a.billId === internet.id)!.recipients).toEqual([{ phone: TEAM, name: 'Bia Souza' }]);

    const occ = (await billing.oldestOpenOccurrence(internet.id))!;
    await billing.registerPayment(orgId, occ.id, {}, actor, NOW);
    auto = await reminders.automaticFromBills(orgId);
    expect(auto.find((a) => a.billId === internet.id)!.next?.dueDate).toBe('2026-12-20');

    await billing.suspendBill(orgId, agua.id, actor, NOW);
    expect((await reminders.automaticFromBills(orgId)).map((a) => a.name)).toEqual(['Internet']);
  });
});

describe('conta de valor variável com estimativa', () => {
  it('estimativa entra no previsto, mas o pagamento exige o valor real e não fica "parcial"', async () => {
    const energia = await billing.createBill(orgId, { name: 'Energia', category: 'energia', dueDay: 25, isVariableAmount: true, estimatedAmountCents: 30000, startsOn: '2026-11-01' }, actor, NOW);
    const occ = (await billing.oldestOpenOccurrence(energia.id))!;
    expect(occ.expectedAmountCents).toBe(30000);
    expect((await billing.summary(orgId, '2026-11')).expectedCents).toBeGreaterThanOrEqual(30000);

    await expectDomainError(billing.registerPayment(orgId, occ.id, {}, actor, NOW), 'validation');
    const paid = await billing.registerPayment(orgId, occ.id, { amountCents: 27450 }, actor, NOW);
    expect(paid.occurrence).toMatchObject({ status: 'paid', expectedAmountCents: 27450, paidAmountCents: 27450 });
  });
});
