/**
 * Endpoints da Etapa 2: códigos HTTP, detalhes de conflito e RBAC por papel.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPrismaClient } from '@coxia/database';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/config/env';
import { createApp } from '../src/main';

const env = loadApiEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  ZAPI_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-00',
  AI_SERVICE_TOKEN: 'test-ai-token-000000',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: 'coxia-media',
  S3_ACCESS_KEY_ID: 'coxia',
  S3_SECRET_ACCESS_KEY: 'coxia-dev-secret',
});

const prisma = createPrismaClient(env.DATABASE_URL);
let app: INestApplication;
let orgId: string;
const tokens: Record<'owner' | 'staff' | 'viewer', string> = { owner: '', staff: '', viewer: '' };
const emails: string[] = [];
let spaceId: string;

const http = () => request(app.getHttpServer());
const as = (role: keyof typeof tokens) => ({ authorization: `Bearer ${tokens[role]}` });
// Datas no futuro para não depender do relógio: sexta da próxima semana do ano seguinte.
const year = new Date().getFullYear() + 1;
const day = `${year}-03-05`; // dia útil (seg–sáb abertos)

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: 'Casa HTTP', slug: `http-${randomUUID()}` } });
  orgId = org.id;
  const hash = await bcrypt.hash('senha-forte-123', 4);
  for (const role of ['owner', 'staff', 'viewer'] as const) {
    const email = `${role}-${randomUUID()}@coxia.test`;
    emails.push(email);
    const u = await prisma.user.create({ data: { email, name: role, passwordHash: hash } });
    await prisma.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role } });
  }
  app = await createApp(env);
  await app.init();
  for (const [i, role] of (['owner', 'staff', 'viewer'] as const).entries()) {
    const res = await http().post('/auth/login').send({ email: emails[i], password: 'senha-forte-123' }).expect(200);
    tokens[role] = res.body.accessToken;
  }
});

afterAll(async () => {
  await app?.close();
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe('salas', () => {
  it('admin cria sala e define funcionamento; staff não', async () => {
    await http().post('/spaces').set(as('staff')).send({ name: 'Sala Grande' }).expect(403);
    const res = await http().post('/spaces').set(as('owner')).send({ name: 'Sala Grande', aliases: ['salão'] }).expect(201);
    spaceId = res.body.id;
    expect(res.body.slug).toBe('sala-grande');
    const rules = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '22:00' }));
    await http().put(`/spaces/${spaceId}/availability`).set(as('owner')).send({ rules }).expect(200);
    await http()
      .put(`/spaces/${spaceId}/availability`)
      .set(as('owner'))
      .send({ rules: [{ weekday: 1, opensAt: '22:00', closesAt: '08:00' }] })
      .expect(422);
    const list = await http().get('/spaces').set(as('viewer')).expect(200);
    expect(list.body[0].availabilityRules).toHaveLength(6);
  });
});

describe('reservas', () => {
  it('staff reserva; viewer só consulta; conflito → 409 com detalhes', async () => {
    const body = { spaceId, startAt: `${day}T14:00:00-03:00`, endAt: `${day}T17:00:00-03:00`, title: 'Ensaio', responsibleName: 'Micaela' };
    await http().post('/bookings').set(as('viewer')).send(body).expect(403);
    const created = await http().post('/bookings').set(as('staff')).send(body).expect(201);
    expect(created.body.occurrences).toHaveLength(1);

    const conflict = await http()
      .post('/bookings')
      .set(as('owner'))
      .send({ ...body, startAt: `${day}T16:00:00-03:00`, endAt: `${day}T18:00:00-03:00` })
      .expect(409);
    expect(conflict.body.code).toBe('conflict');
    expect(conflict.body.details.conflicts[0].with.responsibleName).toBe('Micaela');

    const list = await http()
      .get('/bookings')
      .query({ from: `${day}T00:00:00-03:00`, to: `${day}T23:59:59-03:00` })
      .set(as('viewer'))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].space.name).toBe('Sala Grande');

    const avail = await http().get('/availability').query({ date: day }).set(as('viewer')).expect(200);
    expect(avail.body[0].free).toHaveLength(2);

    await http().post(`/bookings/occurrences/${list.body[0].id}/cancel`).set(as('staff')).expect(200);
    await http().post('/bookings').set(as('owner')).send({ ...body, startAt: `${day}T16:00:00-03:00`, endAt: `${day}T18:00:00-03:00` }).expect(201);
  });

  it('validação: datas sem fuso e intervalo invertido', async () => {
    await http().post('/bookings').set(as('owner')).send({ spaceId, startAt: `${day}T10:00:00`, endAt: `${day}T11:00:00` }).expect(400);
    await http()
      .post('/bookings')
      .set(as('owner'))
      .send({ spaceId, startAt: `${day}T11:00:00-03:00`, endAt: `${day}T10:00:00-03:00` })
      .expect(422);
  });

  it('série com conflito: fail → 409, skip → cria e relata', async () => {
    const body = {
      spaceId,
      startAt: `${day}T16:30:00-03:00`,
      endAt: `${day}T17:30:00-03:00`,
      recurrence: { rule: 'FREQ=WEEKLY', until: `${year}-03-26` },
    };
    await http().post('/bookings').set(as('owner')).send(body).expect(409);
    const res = await http().post('/bookings').set(as('owner')).send({ ...body, onConflict: 'skip' }).expect(201);
    expect(res.body.occurrences).toHaveLength(3);
    expect(res.body.skipped).toHaveLength(1);
  });
});

describe('contas', () => {
  it('admin cadastra, gera ocorrências e registra pagamento; staff não paga', async () => {
    await http().post('/bills').set(as('staff')).send({ name: 'Internet', category: 'internet', dueDay: 20, startsOn: '2026-01-01' }).expect(403);
    const bill = await http()
      .post('/bills')
      .set(as('owner'))
      .send({ name: 'Internet', category: 'internet', dueDay: 31, estimatedAmountCents: 14990, startsOn: '2026-01-01' })
      .expect(201);
    expect(bill.body.dueDay).toBe(31);

    // Competência no fuso da organização (não em UTC: diverge no último dia do mês após 21h).
    const competence = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    const occ = await http().get('/bills/occurrences').query({ competence }).set(as('viewer')).expect(200);
    expect(occ.body).toHaveLength(1);
    const id = occ.body[0].id;

    await http().post(`/bills/occurrences/${id}/payments`).set(as('staff')).send({}).expect(403);
    const paid = await http().post(`/bills/occurrences/${id}/payments`).set(as('owner')).send({ amountCents: 14990 }).expect(201);
    expect(paid.body.occurrence.status).toBe('paid');
    const again = await http().post(`/bills/occurrences/${id}/payments`).set(as('owner')).send({ amountCents: 100 }).expect(409);
    expect(again.body.details.code).toBe('already_paid');

    const summary = await http().get('/bills/summary').query({ competence }).set(as('viewer')).expect(200);
    expect(summary.body).toMatchObject({ total: 1, paid: 1, paidCents: 14990 });
    await http().get('/bills/summary').query({ competence: '2026-13' }).set(as('viewer')).expect(400);
  });

  it('visão geral responde para qualquer papel', async () => {
    const res = await http().get('/overview').set(as('viewer')).expect(200);
    expect(res.body).toHaveProperty('monthSummary');
    expect(res.body.timezone).toBe('America/Sao_Paulo');
  });
});

describe('lembretes', () => {
  it('cria e desativa', async () => {
    const r = await http()
      .post('/reminders')
      .set(as('owner'))
      .send({ title: 'Renovar alvará', dueAt: `${year}-01-10T09:00:00-03:00`, recipientPhones: ['+55 11 90000-0001'] })
      .expect(201);
    expect(r.body.recipientPhones).toEqual(['5511900000001']);
    await http().post(`/reminders/${r.body.id}/deactivate`).set(as('owner')).expect(200);
    await http().post('/reminders').set(as('owner')).send({ title: 'x', dueAt: `${year}-01-10T09:00:00-03:00`, recipientPhones: [] }).expect(400);
  });
});

describe('projetos', () => {
  it('lista, revisa sugestões e encerra com relatório; RBAC por papel', async () => {
    const p = await prisma.project.create({ data: { organizationId: orgId, title: 'XPO', status: 'active', estimatedBudgetCents: 500000 } });
    const msg = { organizationId: orgId, projectId: p.id, sourceMessageId: `m-${randomUUID()}`, commitment: 'suggested' as const };
    const taskEvent = await prisma.projectEvent.create({ data: { ...msg, type: 'task', fingerprint: 'f1', payload: {}, reviewStatus: 'pending_review' } });
    const task = await prisma.projectTask.create({
      data: { organizationId: orgId, projectId: p.id, title: 'Ver a luz', status: 'proposed', sourceEventId: taskEvent.id },
    });
    const quoteEvent = await prisma.projectEvent.create({ data: { ...msg, type: 'quote', fingerprint: 'f2', payload: {}, reviewStatus: 'pending_review' } });
    const quote = await prisma.projectExpense.create({
      data: { organizationId: orgId, projectId: p.id, kind: 'quote', description: 'Som', amountCents: 250000, status: 'proposed', sourceEventId: quoteEvent.id },
    });
    const decision = await prisma.projectEvent.create({
      data: {
        ...msg,
        type: 'decision',
        fingerprint: 'f3',
        payload: { type: 'decision', summary: 'Abertura às 19h', sourceMessageId: msg.sourceMessageId, confidence: 0.6, commitment: 'suggested', evidence: 'x' },
        reviewStatus: 'pending_review',
      },
    });

    const list = await http().get('/projects').set(as('viewer')).expect(200);
    expect(list.body[0]).toMatchObject({ title: 'XPO', status: 'active', toReview: 3, openTasks: 0 });

    const detail = await http().get(`/projects/${p.id}`).set(as('viewer')).expect(200);
    expect(detail.body.suggestions.map((s: { type: string }) => s.type)).toEqual(['decision']);
    expect(detail.body.tasks[0]).toMatchObject({ title: 'Ver a luz', status: 'proposed' });

    // Equipe aprova tarefa proposta; quem só visualiza, não.
    await http().patch(`/projects/${p.id}/tasks/${task.id}`).set(as('viewer')).send({ status: 'open' }).expect(403);
    await http().patch(`/projects/${p.id}/tasks/${task.id}`).set(as('staff')).send({ status: 'open', assigneeName: 'Bruno' }).expect(200);
    expect((await prisma.projectEvent.findUniqueOrThrow({ where: { id: taskEvent.id } })).reviewStatus).toBe('confirmed');
    await http().patch(`/projects/${p.id}/tasks/${task.id}`).set(as('staff')).send({ status: 'proposed' }).expect(422);

    // Validação financeira só para administração; cotação aprovada vira confirmada, nunca paga sozinha.
    await http().post(`/projects/${p.id}/expenses/${quote.id}/review`).set(as('staff')).send({ action: 'confirm' }).expect(403);
    const confirmed = await http().post(`/projects/${p.id}/expenses/${quote.id}/review`).set(as('owner')).send({ action: 'confirm' }).expect(200);
    expect(confirmed.body.status).toBe('confirmed');
    await http().post(`/projects/${p.id}/expenses/${quote.id}/review`).set(as('owner')).send({ action: 'confirm' }).expect(422);

    await http().post(`/projects/${p.id}/events/${decision.id}/review`).set(as('owner')).send({ decision: 'confirm' }).expect(204);
    expect(await prisma.projectDecision.count({ where: { projectId: p.id } })).toBe(1);
    await http().post(`/projects/${p.id}/events/${decision.id}/review`).set(as('owner')).send({ decision: 'confirm' }).expect(422);

    await http().post(`/projects/${p.id}/close`).set(as('staff')).expect(403);
    const closed = await http().post(`/projects/${p.id}/close`).set(as('owner')).expect(200);
    expect(closed.body.report).toContain('Projeto *XPO* encerrado');
    await http().post(`/projects/${p.id}/close`).set(as('owner')).expect(422);
    await http().get(`/projects/${randomUUID()}`).set(as('viewer')).expect(404);
  });
});
