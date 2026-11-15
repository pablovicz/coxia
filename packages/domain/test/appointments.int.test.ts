/**
 * Calendário da equipe: compromissos (equipe toda ou só algumas pessoas, contatos e pessoas de fora),
 * lembretes (recorrentes expandidos) e contas, separados da agenda das salas.
 * Relógio fixo: sexta, 13/11/2026 (America/Sao_Paulo).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  AppointmentService,
  BillingService,
  CalendarService,
  composeMorningBriefing,
  DomainError,
  loadBriefingState,
  NotificationService,
  ReminderService,
} from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-13T08:00');
const SUFFIX = String(Date.now()).slice(-7);
const KAO = `551191${SUFFIX}`;
const JULIA = `551192${SUFFIX}`;
const appointments = new AppointmentService(db);
const calendar = new CalendarService(db);
let orgId: string;
let kaoMember: string;
let juliaMember: string;
let semFoneMember: string;
let carlaId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Calendário', slug: `cal-${randomUUID()}` } })).id;
  const mk = async (name: string, phone: string | null) => {
    const u = await db.user.create({ data: { name, phone } });
    return (await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'admin', receivesMorningBriefing: !!phone } })).id;
  };
  kaoMember = await mk('Kaoana', KAO);
  juliaMember = await mk('Julia', JULIA);
  semFoneMember = await mk(`Sem Fone ${SUFFIX}`, null);
  carlaId = (await db.contact.create({ data: { organizationId: orgId, phone: '5511987650002', name: 'Carla (iluminação)', searchName: 'carla' } })).id;
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { OR: [{ phone: { in: [KAO, JULIA] } }, { name: `Sem Fone ${SUFFIX}` }] } });
  await db.$disconnect();
});

describe('compromissos', () => {
  it('só uma pessoa da equipe, com contato e pessoa de fora; valida o essencial', async () => {
    const a = await appointments.create(
      orgId,
      {
        kind: 'visit',
        title: 'Visita técnica do som',
        location: 'Sala Grande',
        startAt: at('2026-11-13T15:00'),
        endAt: at('2026-11-13T16:00'),
        memberIds: [kaoMember],
        contactIds: [carlaId],
        guests: [{ name: 'Seu Zé do som', phone: '(11) 3333-4444' }],
        notifyMinutesBefore: 30,
      },
      actor,
    );
    expect(a).toMatchObject({ kind: 'visit', allTeam: false, notifyMinutesBefore: 30, status: 'scheduled' });
    expect(a.participants.map((p) => p.member?.user.name ?? p.contact?.name ?? p.name).sort()).toEqual(['Carla (iluminação)', 'Kaoana', 'Seu Zé do som']);
    expect(a.participants.find((p) => p.name === 'Seu Zé do som')?.phone).toBe('551133334444');
    // Aviso só para quem é da equipe e vai.
    expect(await appointments.teamPhones(orgId, a)).toEqual([KAO]);

    await expectDomainError(appointments.create(orgId, { title: 'Sem ninguém', startAt: at('2026-11-14T10:00'), endAt: at('2026-11-14T11:00') }, actor), 'validation');
    await expectDomainError(
      appointments.create(orgId, { title: 'Ao contrário', allTeam: true, startAt: at('2026-11-14T11:00'), endAt: at('2026-11-14T10:00') }, actor),
      'validation',
    );
    await expectDomainError(
      appointments.create(orgId, { title: 'Outro lugar', memberIds: ['nao-existe'], startAt: at('2026-11-14T10:00'), endAt: at('2026-11-14T11:00') }, actor),
      'not_found',
    );
  });

  it('toda a equipe: avisa quem tem WhatsApp; edição troca participantes; cancelado some do calendário', async () => {
    const a = await appointments.create(
      orgId,
      { kind: 'meeting', title: 'Reunião de planejamento', allTeam: true, startAt: at('2026-11-16T10:00'), endAt: at('2026-11-16T11:30') },
      actor,
    );
    expect((await appointments.teamPhones(orgId, a)).sort()).toEqual([JULIA, KAO].sort());

    const edited = await appointments.update(
      orgId,
      a.id,
      { kind: 'meeting', title: 'Reunião de planejamento', memberIds: [juliaMember, semFoneMember], startAt: at('2026-11-16T10:00'), endAt: at('2026-11-16T11:00') },
      actor,
    );
    expect(edited.allTeam).toBe(false);
    expect(edited.participants).toHaveLength(2);
    expect(await appointments.teamPhones(orgId, edited)).toEqual([JULIA]);

    await appointments.cancel(orgId, a.id, actor);
    const cal = await calendar.range(orgId, at('2026-11-16T00:00'), at('2026-11-17T00:00'));
    expect(cal.appointments.map((x) => x.id)).not.toContain(a.id);
    await expectDomainError(appointments.update(orgId, a.id, { title: 'x', allTeam: true, startAt: at('2026-11-16T10:00'), endAt: at('2026-11-16T11:00') }, actor), 'conflict');
  });

  it('aviso antes pelo WhatsApp (só na antecedência escolhida) e seção no briefing da manhã', async () => {
    const a = await appointments.create(
      orgId,
      { kind: 'meeting', title: 'Reunião com a prefeitura', location: 'Secretaria de Cultura', memberIds: [kaoMember, juliaMember], startAt: at('2026-11-13T14:00'), endAt: at('2026-11-13T15:00'), notifyMinutesBefore: 60 },
      actor,
    );
    const notifications = new NotificationService(db);
    // 2h antes: ainda não.
    expect(await notifications.run(orgId, at('2026-11-13T12:00'))).not.toContain(`appointment_before:${a.id}:${a.startAt.toISOString()}`);
    // 1h antes: sai uma vez para as duas.
    expect(await notifications.run(orgId, at('2026-11-13T13:05'))).toContain(`appointment_before:${a.id}:${a.startAt.toISOString()}`);
    expect(await notifications.run(orgId, at('2026-11-13T13:10'))).not.toContain(`appointment_before:${a.id}:${a.startAt.toISOString()}`);
    const sent = await db.notificationDelivery.findMany({ where: { organizationId: orgId, text: { startsWith: '📅 Reunião hoje' } } });
    expect(sent.map((d) => d.recipient).sort()).toEqual([JULIA, KAO].sort());
    expect(sent[0]!.text).toBe('📅 Reunião hoje, 14h–15h: Reunião com a prefeitura\nLocal: Secretaria de Cultura\nCom: Julia, Kaoana');

    const briefing = composeMorningBriefing(await loadBriefingState(db, orgId, '2026-11-13'));
    expect(briefing).toContain('*Compromissos de hoje*');
    expect(briefing).toContain('• 14h–15h · Reunião: Reunião com a prefeitura — Secretaria de Cultura (Julia, Kaoana)');
  });
});

describe('calendário da equipe', () => {
  it('junta compromissos, lembretes (recorrentes expandidos) e contas do período', async () => {
    const reminders = new ReminderService(db);
    await reminders.create(orgId, { title: 'Enviar dossiê para XPO', dueAt: at('2026-11-18T09:00'), recipientPhones: [KAO] }, actor);
    const weekly = await reminders.create(
      orgId,
      { title: 'Deixar a chave com o Seu João', dueAt: at('2026-11-02T18:00'), recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,FR', recipientPhones: [JULIA] },
      actor,
    );
    await new BillingService(db).createBill(orgId, { name: 'Internet', dueDay: 20, estimatedAmountCents: 14990, startsOn: '2026-11-01' }, actor, NOW);

    const cal = await calendar.range(orgId, at('2026-11-16T00:00'), at('2026-11-23T00:00'));
    expect(cal.reminders.map((r) => [r.title, r.at])).toEqual([
      ['Deixar a chave com o Seu João', at('2026-11-16T18:00').toISOString()],
      ['Enviar dossiê para XPO', at('2026-11-18T09:00').toISOString()],
      ['Deixar a chave com o Seu João', at('2026-11-20T18:00').toISOString()],
    ]);
    expect(cal.reminders.every((r) => !r.done)).toBe(true);
    expect(cal.bills.map((b) => [b.name, b.dueDate, b.expectedAmountCents])).toEqual([['Internet', '2026-11-20', 14990]]);

    // Encerrado: as ocorrências depois do encerramento somem.
    await reminders.deactivate(orgId, weekly.id, actor);
    const after = await calendar.range(orgId, at('2026-11-16T00:00'), at('2026-11-23T00:00'));
    expect(after.reminders.map((r) => r.title)).toEqual(['Enviar dossiê para XPO']);

    await expectDomainError(calendar.range(orgId, at('2026-11-16T00:00'), at('2028-01-01T00:00')), 'validation');
  });
});

describe('projeto nos compromissos e lembretes', () => {
  it('liga ao projeto da casa (aparece no calendário); projeto de outra casa é recusado', async () => {
    const project = await db.project.create({ data: { organizationId: orgId, title: 'XPO', status: 'active' } });
    const a = await appointments.create(
      orgId,
      { title: 'Reunião da XPO', memberIds: [kaoMember], projectId: project.id, startAt: at('2026-11-24T10:00'), endAt: at('2026-11-24T11:00') },
      actor,
    );
    expect(a.project).toEqual({ id: project.id, title: 'XPO' });
    const r = await new ReminderService(db).create(orgId, { title: 'Enviar rider da XPO', projectId: project.id, dueAt: at('2026-11-24T09:00'), recipientPhones: [KAO] }, actor);
    expect(r.project).toEqual({ id: project.id, title: 'XPO' });
    const cal = await calendar.range(orgId, at('2026-11-24T00:00'), at('2026-11-25T00:00'));
    expect(cal.reminders.find((x) => x.reminderId === r.id)?.project).toEqual({ id: project.id, title: 'XPO' });

    const other = (await db.organization.create({ data: { name: 'Outra', slug: `outra-${randomUUID()}` } })).id;
    try {
      const foreign = await db.project.create({ data: { organizationId: other, title: 'Alheio', status: 'active' } });
      await expectDomainError(
        appointments.create(orgId, { title: 'x', allTeam: true, projectId: foreign.id, startAt: at('2026-11-24T10:00'), endAt: at('2026-11-24T11:00') }, actor),
        'not_found',
      );
    } finally {
      await db.organization.delete({ where: { id: other } });
    }
  });
});
