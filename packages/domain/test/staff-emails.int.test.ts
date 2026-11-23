/**
 * Avisos por e-mail para as administradoras: lembretes (mesmo sem telefone cadastrado) e pedidos
 * de orçamento do site. Vão junto com o WhatsApp, pelo outbox, sem duplicar.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContactService, ContactTypeService, DomainError, NotificationService, QuoteRequestService } from '../src';

const db = createPrismaClient();
const run = randomUUID().slice(0, 8);
const at = (local: string) => new Date(`${local}-03:00`);
const OWNER = `owner-${run}@casakaju.test`;
const ADMIN = `admin-${run}@casakaju.test`;
const STAFF = `staff-${run}@casakaju.test`;
let orgId: string;

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Kaju', slug: `avisos-${run}` } })).id;
  for (const [email, role] of [[OWNER, 'owner'], [ADMIN, 'admin'], [STAFF, 'staff']] as const) {
    const u = await db.user.create({ data: { name: role, email } });
    await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role } });
  }
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { email: { in: [OWNER, ADMIN, STAFF] } } });
  await db.$disconnect();
});

const emailsTo = (prefix: string) =>
  db.notificationDelivery.findMany({ where: { organizationId: orgId, channel: 'email', idempotencyKey: { startsWith: prefix } }, orderBy: { recipient: 'asc' } });

describe('e-mail para as administradoras', () => {
  it('lembrete sem telefone: vai por e-mail para owner e admin (não para a equipe) e avança', async () => {
    const r = await db.reminder.create({ data: { organizationId: orgId, kind: 'one_time', title: 'Trocar o filtro', dueAt: at('2026-11-21T09:00'), nextRunAt: at('2026-11-21T09:00') } });
    const notifications = new NotificationService(db);
    await notifications.run(orgId, at('2026-11-21T09:05'));
    await notifications.run(orgId, at('2026-11-21T09:06'));
    const mails = await emailsTo(`${orgId}:reminder:${r.id}`);
    expect(mails.map((m) => m.recipient)).toEqual([ADMIN, OWNER].sort());
    expect(mails[0]!.payload).toMatchObject({ template: 'staff_notice', subject: 'Lembrete: Trocar o filtro', path: '/lembretes' });
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).active).toBe(false);
  });

  it('pedido de orçamento: e-mail para as administradoras com resposta para o cliente', async () => {
    const res = await new QuoteRequestService(db).submit(orgId, {
      name: 'Coletivo Lume',
      email: 'oi@lume.art',
      phone: `4199${run.replace(/\D/g, '1').slice(0, 7).padEnd(7, '1')}`,
      segment: 'theater',
      services: ['costume'],
      description: 'Figurinos para uma peça infantil em março.',
    });
    const mails = await emailsTo(`quote_request:${res.id}:email:`);
    expect(mails.map((m) => m.recipient)).toEqual([ADMIN, OWNER].sort());
    expect(mails[0]!.payload).toMatchObject({ template: 'staff_notice', subject: 'Novo pedido de orçamento: Coletivo Lume', path: '/orcamentos', replyTo: 'oi@lume.art' });
    expect((mails[0]!.payload as { text: string }).text).not.toContain('Veja e acompanhe');
  });

  it('quem pede orçamento vira lead', async () => {
    const lead = await db.quoteRequest.findFirstOrThrow({ where: { organizationId: orgId }, include: { contact: true } });
    expect(lead.contact!.kind).toBe('lead');
    const leads = await new ContactService(db).list(orgId, { kind: 'lead' });
    expect(leads.items.map((c) => c.id)).toContain(lead.contactId);
  });

  it('tipos de contato: cadastra, filtra, renomeia e apagar não apaga o contato', async () => {
    const types = new ContactTypeService(db);
    const contacts = new ContactService(db);
    const actor = { channel: 'web' as const, userId: null };
    const costura = await types.create(orgId, '  Costureiras ', actor);
    expect(costura.name).toBe('Costureiras');
    const dup = await types.create(orgId, 'costureiras', actor).catch((e: unknown) => e);
    expect((dup as DomainError).code).toBe('conflict');
    const reserved = await types.create(orgId, 'Residentes', actor).catch((e: unknown) => e);
    expect((reserved as DomainError).details).toMatchObject({ code: 'reserved_type' });

    const c = await contacts.create(orgId, { name: 'Dona Lurdes', phone: `4198${run.replace(/\D/g, '2').slice(0, 7).padEnd(7, '2')}`, typeId: costura.id }, actor);
    expect(c.type).toMatchObject({ name: 'Costureiras' });
    expect((await contacts.list(orgId, { typeId: costura.id })).items.map((x) => x.id)).toEqual([c.id]);
    expect((await types.list(orgId)).find((t) => t.id === costura.id)?.contacts).toBe(1);

    await types.rename(orgId, costura.id, 'Costura', actor);
    await types.remove(orgId, costura.id, actor);
    const after = await contacts.get(orgId, c.id);
    expect(after.typeId).toBeNull();
    expect((await contacts.list(orgId, { typeId: 'none' })).items.map((x) => x.id)).toContain(c.id);
  });
});
