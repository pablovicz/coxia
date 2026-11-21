/**
 * Avisos por e-mail para as administradoras: lembretes (mesmo sem telefone cadastrado) e pedidos
 * de orçamento do site. Vão junto com o WhatsApp, pelo outbox, sem duplicar.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationService, QuoteRequestService } from '../src';

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
});
