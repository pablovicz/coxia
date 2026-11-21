/**
 * Workspace do residente pela API: convite → senha → login; isolamento entre residente e equipe
 * (e entre residentes); reserva com saldo; check-in pela equipe; SSE de atualização.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPrismaClient } from '@coxia/database';
import { hashAuthToken } from '@coxia/domain';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/config/env';
import { createApp } from '../src/main';

const env = loadApiEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  WHATSAPP_PROVIDER: 'fake',
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-00',
  AI_SERVICE_TOKEN: 'test-ai-token-000000',
  ZAPI_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: 'coxia-media',
  S3_ACCESS_KEY_ID: 'coxia',
  S3_SECRET_ACCESS_KEY: 'coxia-dev-secret',
});

const prisma = createPrismaClient(env.DATABASE_URL);
let app: INestApplication;
let orgId: string;
let spaceId: string;
let lumeId: string;
let xpoId: string;
let contractId: string;
let adminToken: string;
let lumeToken: string;
const run = randomUUID().slice(0, 8);
const adminEmail = `admin-${run}@coxia.test`;
const lumeEmail = `lume-${run}@residente.test`;
const xpoEmail = `xpo-${run}@residente.test`;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** Daqui a N dias, no horário local informado (America/Sao_Paulo, sem horário de verão). */
function slot(daysAhead: number, hhmm: string) {
  const date = new Date(Date.now() + daysAhead * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${date}T${hhmm}:00-03:00`);
}

/** Lê o token do e-mail de convite enfileirado e troca por um conhecido (o banco só guarda o hash). */
async function inviteToken(email: string) {
  const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { recipient: email, channel: 'email' }, orderBy: { createdAt: 'desc' } });
  return (delivery.payload as { token: string }).token;
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: 'Casa Kaju', slug: `res-api-${run}` } })).id;
  const u = await prisma.user.create({ data: { email: adminEmail, name: 'Admin', passwordHash: await bcrypt.hash('senha-forte-123', 4) } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'admin' } });
  spaceId = (await prisma.space.create({ data: { organizationId: orgId, name: 'Sala Média', slug: 'sala-media' } })).id; // sem regras = sempre aberta
  app = await createApp(env);
  await app.init();
  adminToken = (await http().post('/auth/login').send({ email: adminEmail, password: 'senha-forte-123' })).body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: adminEmail } });
  await prisma.$disconnect();
});

describe('acesso do residente', () => {
  it('admin cadastra residentes e contrato', async () => {
    const mk = async (name: string, phone: string, email: string) =>
      (await http().post('/residents').set(auth(adminToken)).send({ name, phone, email }).expect(201)).body.id as string;
    lumeId = await mk('Coletivo Lume', `4199${run.replace(/\D/g, '0').slice(0, 7).padEnd(7, '1')}`, lumeEmail);
    xpoId = await mk('Cia XPO', `4198${run.replace(/\D/g, '0').slice(0, 7).padEnd(7, '2')}`, xpoEmail);
    const res = await http()
      .post(`/residents/${lumeId}/contracts`)
      .set(auth(adminToken))
      .send({ spaceId, monthlyMinutes: 600, monthlyAmountCents: 90000, cycleDay: 1, bookingOpensDay: 15, startsOn: '2026-01-01' })
      .expect(201);
    contractId = res.body.id;
    await http().post(`/residents/${xpoId}/contracts`).set(auth(adminToken)).send({ spaceId, monthlyMinutes: 120, cycleDay: 1, bookingOpensDay: 15, startsOn: '2026-01-01' }).expect(201);
  });

  it('convite → definir senha → login; link vale uma vez', async () => {
    const res = await http().post(`/residents/${lumeId}/access/invite`).set(auth(adminToken)).expect(200);
    expect(res.body).toMatchObject({ email: lumeEmail, status: 'invited', hasPassword: false });
    const token = await inviteToken(lumeEmail);
    await http().post('/resident-auth/password').send({ token, password: 'curta' }).expect(422);
    await http().post('/resident-auth/password').send({ token, password: 'senha-do-lume' }).expect(204);
    await http().post('/resident-auth/password').send({ token, password: 'outra-senha-1' }).expect(422);
    expect((await prisma.residentAuthToken.findUniqueOrThrow({ where: { tokenHash: hashAuthToken(token) } })).usedAt).not.toBeNull();
    await http().post('/resident-auth/login').send({ email: lumeEmail, password: 'errada-123' }).expect(401);
    const login = await http().post('/resident-auth/login').send({ email: lumeEmail.toUpperCase(), password: 'senha-do-lume' }).expect(200);
    lumeToken = login.body.accessToken;
    expect(login.body.resident).toMatchObject({ id: lumeId, name: 'Coletivo Lume' });
  });

  it('token do residente não entra em rota da equipe, e o da equipe não entra no workspace', async () => {
    await http().get('/residents').set(auth(lumeToken)).expect(403);
    await http().get('/bookings').query({ from: new Date().toISOString(), to: new Date().toISOString() }).set(auth(lumeToken)).expect(403);
    await http().get('/auth/me').set(auth(lumeToken)).expect(403);
    await http().get('/me').set(auth(adminToken)).expect(403);
    await http().post('/resident-auth/login').send({ email: adminEmail, password: 'senha-forte-123' }).expect(401);
  });

  it('GET /me traz os contratos do residente com o saldo', async () => {
    const res = await http().get('/me').set(auth(lumeToken)).expect(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0]).toMatchObject({ id: contractId, monthlyMinutes: 600, balance: { current: { availableMinutes: 600 } } });
  });

  it('esqueci a senha responde igual para qualquer e-mail', async () => {
    await http().post('/resident-auth/forgot').send({ email: 'ninguem@nada.test' }).expect(204);
    await http().post('/resident-auth/forgot').send({ email: lumeEmail }).expect(204);
    expect(await prisma.notificationDelivery.count({ where: { recipient: lumeEmail, idempotencyKey: { startsWith: 'password_reset:' } } })).toBe(1);
  });
});

describe('reservas pelo workspace', () => {
  let occurrenceId: string;

  it('reserva, aparece na agenda da equipe e desconta do saldo', async () => {
    const startAt = slot(1, '14:00');
    const endAt = new Date(startAt.getTime() + 2 * 3600_000);
    const res = await http().post('/me/bookings').set(auth(lumeToken)).set('idempotency-key', randomUUID()).send({ contractId, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
    // amanhã cai no ciclo atual ou, depois da virada (dia 15), no próximo, que já está aberto
    expect(res.status).toBe(201);
    occurrenceId = res.body.occurrences[0].id;
    const agenda = await http().get('/bookings').query({ from: startAt.toISOString(), to: endAt.toISOString() }).set(auth(adminToken)).expect(200);
    expect(agenda.body.find((o: { id: string }) => o.id === occurrenceId)?.booking).toMatchObject({ contractId, source: 'resident' });
  });

  it('outro residente não vê nem cancela', async () => {
    await http().post(`/residents/${xpoId}/access/invite`).set(auth(adminToken)).expect(200);
    await http().post('/resident-auth/password').send({ token: await inviteToken(xpoEmail), password: 'senha-da-xpo' }).expect(204);
    const xpo = (await http().post('/resident-auth/login').send({ email: xpoEmail, password: 'senha-da-xpo' }).expect(200)).body.accessToken;
    await http().get(`/me/contracts/${contractId}`).set(auth(xpo)).expect(404);
    await http().post(`/me/bookings/occurrences/${occurrenceId}/cancel`).set(auth(xpo)).expect(404);
  });

  it('acesso desativado vale na hora', async () => {
    const tmp = (await http().post('/resident-auth/login').send({ email: lumeEmail, password: 'senha-do-lume' })).body.accessToken;
    await http().delete(`/residents/${lumeId}/access`).set(auth(adminToken)).expect(200);
    await http().get('/me').set(auth(tmp)).expect(401);
    await http().post(`/residents/${lumeId}/access/invite`).set(auth(adminToken)).expect(200);
    const again = await http().post('/resident-auth/login').send({ email: lumeEmail, password: 'senha-do-lume' }).expect(200);
    lumeToken = again.body.accessToken;
  });

  it('ajuste de saldo pela equipe e cancelamento pelo residente devolvem as horas', async () => {
    await http().post(`/contracts/${contractId}/adjustments`).set(auth(adminToken)).send({ minutes: 60, note: 'Cortesia' }).expect(201);
    await http().post(`/me/bookings/occurrences/${occurrenceId}/cancel`).set(auth(lumeToken)).expect(200);
    const res = await http().get(`/contracts/${contractId}`).set(auth(adminToken)).expect(200);
    const current = res.body.cycles[0];
    expect(current.adjustedMinutes).toBe(60);
    expect(current.reservedMinutes + current.usedMinutes).toBe(0);
  });

  it('SSE: ticket curto, recusado em rota normal, e evento chega após uma reserva', async () => {
    const { ticket } = (await http().post('/me/events/ticket').set(auth(lumeToken)).expect(200)).body;
    await http().get('/me').set(auth(ticket)).expect(401);
    await http().get('/events').query({ ticket: 'invalido' }).expect(401);

    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/events?ticket=${ticket}`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    let buffer = '';
    const read = (async () => {
      while (!buffer.includes('event: change')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
      }
    })();
    await new Promise((r) => setTimeout(r, 300));
    const startAt = slot(1, '17:00');
    await http().post('/me/bookings').set(auth(lumeToken)).send({ contractId, startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 3600_000).toISOString() }).expect(201);
    await Promise.race([read, new Promise((r) => setTimeout(r, 5000))]);
    ctrl.abort();
    expect(buffer).toContain('event: change');
    expect(buffer).toMatch(/"type":"(booking|hours)\.changed"/);
  });
});

describe('senha provisória', () => {
  it('admin define; residente entra, só acessa a troca, troca e segue com o token novo', async () => {
    await http().post(`/residents/${xpoId}/access/password`).set(auth(adminToken)).send({ password: 'curta' }).expect(400);
    const res = await http().post(`/residents/${xpoId}/access/password`).set(auth(adminToken)).send({ password: 'provisoria-123' }).expect(200);
    expect(res.body).toMatchObject({ status: 'active', mustChangePassword: true });

    // sessões antigas caem (iat anterior à senha nova)
    await new Promise((r) => setTimeout(r, 1100));
    await http().post('/resident-auth/login').send({ email: xpoEmail, password: 'senha-da-xpo' }).expect(401);
    const login = await http().post('/resident-auth/login').send({ email: xpoEmail, password: 'provisoria-123' }).expect(200);
    expect(login.body.mustChangePassword).toBe(true);
    const tmp = login.body.accessToken as string;

    const me = await http().get('/me').set(auth(tmp)).expect(200);
    expect(me.body).toMatchObject({ mustChangePassword: true, contracts: [] });
    const blocked = await http().get('/me/payments').set(auth(tmp)).expect(403);
    expect(blocked.body.details).toMatchObject({ code: 'password_change_required' });

    await http().post('/resident-auth/change-password').set(auth(tmp)).send({ currentPassword: 'errada-000', newPassword: 'nova-senha-xpo' }).expect(422);
    await http().post('/resident-auth/change-password').set(auth(tmp)).send({ currentPassword: 'provisoria-123', newPassword: 'provisoria-123' }).expect(422);
    const changed = await http().post('/resident-auth/change-password').set(auth(tmp)).send({ currentPassword: 'provisoria-123', newPassword: 'nova-senha-xpo' }).expect(200);
    const fresh = changed.body.accessToken as string;

    await http().get('/me/payments').set(auth(tmp)).expect(401);
    await http().get('/me/payments').set(auth(fresh)).expect(200);
    expect((await http().get('/me').set(auth(fresh)).expect(200)).body.mustChangePassword).toBe(false);
    const access = await http().get(`/residents/${xpoId}/access`).set(auth(adminToken)).expect(200);
    expect(access.body).toMatchObject({ status: 'active', mustChangePassword: false });
  });
});
