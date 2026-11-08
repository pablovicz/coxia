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
    const body = { spaceId, startAt: `${day}T14:00:00-03:00`, endAt: `${day}T17:00:00-03:00`, title: 'Ensaio', responsibleName: 'Micaela', responsiblePhone: '11987654321' };
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
      .send({ spaceId, startAt: `${day}T11:00:00-03:00`, endAt: `${day}T10:00:00-03:00`, responsibleName: 'Bia', responsiblePhone: '11911112222' })
      .expect(422);
  });

  it('reserva sem nome e telefone de quem vai usar a sala é recusada', async () => {
    const res = await http()
      .post('/bookings')
      .set(as('owner'))
      .send({ spaceId, startAt: `${day}T19:00:00-03:00`, endAt: `${day}T20:00:00-03:00`, responsibleName: 'Só o nome' })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('telefone');
  });

  it('semanal em vários dias com horário por dia e desconto; cancelar a reserva inteira', async () => {
    const res = await http()
      .post('/bookings')
      .set(as('staff'))
      .send({
        spaceId,
        weekly: {
          startsOn: `${year}-04-06`,
          until: `${year}-04-17`,
          slots: [
            { weekday: 1, start: '09:00', end: '10:00' },
            { weekday: 3, start: '09:00', end: '10:00' },
            { weekday: 5, start: '18:00', end: '20:00' },
          ],
        },
        responsibleName: 'Coletivo Lume',
        responsiblePhone: '11977776666',
        hourlyRateCents: 5000,
      })
      .expect(201);
    expect(res.body.bookings).toHaveLength(2);
    expect(res.body.occurrences.length).toBeGreaterThan(0);
    expect(res.body.occurrences.every((o: { booking: { hourlyRateCents: number } }) => o.booking.hourlyRateCents === 5000)).toBe(true);
    const cancel = await http()
      .post(`/bookings/${res.body.bookings[0].id}/cancel-series`)
      .set(as('staff'))
      .send({ fromDate: `${year}-04-06`, wholeGroup: true })
      .expect(200);
    expect(cancel.body.cancelled).toBe(res.body.occurrences.length);
  });

  it('série com conflito: fail → 409, skip → cria e relata', async () => {
    const body = {
      spaceId,
      startAt: `${day}T16:30:00-03:00`,
      endAt: `${day}T17:30:00-03:00`,
      recurrence: { rule: 'FREQ=WEEKLY', until: `${year}-03-26` },
      responsibleName: 'Micaela',
      responsiblePhone: '11987654321',
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

describe('segurança (Etapa 4)', () => {
  it('papel e vínculo vêm do banco: rebaixar ou remover vale na hora, sem esperar o token expirar', async () => {
    const staffMember = await prisma.organizationMember.findFirstOrThrow({ where: { organizationId: orgId, role: 'staff' } });
    await prisma.organizationMember.update({ where: { id: staffMember.id }, data: { role: 'viewer' } });
    await http().post('/bookings').set(as('staff')).send({ spaceId, startAt: `${year}-03-06T08:00:00-03:00`, endAt: `${year}-03-06T09:00:00-03:00` }).expect(403);
    await prisma.organizationMember.update({ where: { id: staffMember.id }, data: { role: 'staff' } });

    const email = `temp-${randomUUID()}@coxia.test`;
    emails.push(email);
    const u = await prisma.user.create({ data: { email, name: 'Temporária', passwordHash: await bcrypt.hash('senha-forte-123', 4) } });
    const m = await prisma.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role: 'admin' } });
    const token = (await http().post('/auth/login').send({ email, password: 'senha-forte-123' }).expect(200)).body.accessToken as string;
    await http().get('/auth/me').set({ authorization: `Bearer ${token}` }).expect(200);
    await prisma.organizationMember.delete({ where: { id: m.id } });
    await http().get('/auth/me').set({ authorization: `Bearer ${token}` }).expect(401);
  });

  it('login: a 6ª tentativa errada seguida é bloqueada com 429, mesmo com a senha certa', async () => {
    const email = emails[2]!; // viewer
    for (let i = 0; i < 5; i++) await http().post('/auth/login').send({ email, password: `errada-${i}` }).expect(401);
    const blocked = await http().post('/auth/login').send({ email, password: 'senha-forte-123' }).expect(429);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('operação (Etapa 4)', () => {
  it('visão de saúde só para administração; reprocessa mensagem com falha e entrega do dead-letter', async () => {
    await http().get('/ops/overview').set(as('staff')).expect(403);
    const instance = await prisma.whatsappInstance.create({
      data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID(), connected: false, lastCheckedAt: new Date(), lastError: 'sessão expirada' },
    });
    const conv = await prisma.conversation.create({ data: { organizationId: orgId, instanceId: instance.id, externalChatId: `5511${Date.now()}`, isGroup: false } });
    const failed = await prisma.message.create({
      data: {
        organizationId: orgId,
        conversationId: conv.id,
        direction: 'inbound',
        provider: 'fake',
        dedupeKey: `ops:${randomUUID()}`,
        kind: 'text',
        text: 'oi',
        sentAt: new Date(),
        processingStatus: 'failed',
        processingError: 'IA indisponível',
      },
    });
    const dead = await prisma.notificationDelivery.create({
      data: { organizationId: orgId, recipient: '5511900000000', text: 'aviso', idempotencyKey: `ops:${randomUUID()}`, status: 'dead', attempts: 5, lastError: 'HTTP 400' },
    });
    await prisma.aiExecution.create({ data: { organizationId: orgId, operation: 'interpret_command', status: 'failed', requestHash: 'h', error: 'network: timeout' } });

    const overview = await http().get('/ops/overview').set(as('owner')).expect(200);
    expect(overview.body.whatsapp).toEqual([expect.objectContaining({ provider: 'fake', connected: false, lastError: 'sessão expirada' })]);
    expect(overview.body.inbound.last24h.failed).toBe(1);
    expect(overview.body.outbox.byStatus.dead).toBe(1);
    expect(overview.body.ai).toEqual([expect.objectContaining({ operation: 'interpret_command', calls: 1, failures: 1 })]);

    const list = await http().get('/ops/messages/failed').set(as('owner')).expect(200);
    expect(list.body.map((m: { id: string }) => m.id)).toEqual([failed.id]);
    await http().post(`/ops/messages/${failed.id}/retry`).set(as('owner')).expect(202);
    // Voltou ao fluxo (um worker rodando pode já tê-la pego).
    expect((await prisma.message.findUniqueOrThrow({ where: { id: failed.id } })).processingStatus).not.toBe('failed');
    await http().post(`/ops/messages/${failed.id}/retry`).set(as('owner')).expect(422);

    await http().post(`/ops/deliveries/${dead.id}/retry`).set(as('owner')).expect(202);
    const back = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: dead.id } });
    expect([back.status, back.attempts, back.lastError]).toEqual(['pending', 0, null]);
    await http().post(`/ops/deliveries/${dead.id}/retry`).set(as('owner')).expect(404);
    expect(await prisma.auditEvent.count({ where: { organizationId: orgId, action: { in: ['ops.message_retry', 'ops.delivery_retry'] } } })).toBe(2);
  });
});

describe('salas: cadastro, situação e fotos', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  let roomId: string;

  it('admin cria com descrição, cor e ícone; valores fora da lista são recusados', async () => {
    await http().post('/spaces').set(as('owner')).send({ name: 'Sala Lilás', color: 'neon' }).expect(400);
    const res = await http()
      .post('/spaces')
      .set(as('owner'))
      .send({ name: 'Sala Lilás', description: 'Com piano de parede', color: 'ameixa', icon: 'piano' })
      .expect(201);
    roomId = res.body.id;
    expect(res.body).toMatchObject({ status: 'available', color: 'ameixa', icon: 'piano', description: 'Com piano de parede' });
    await http().post('/spaces').set(as('owner')).send({ name: 'Sala Lilás' }).expect(409);
  });

  it('foto: só admin envia; só imagem de verdade; qualquer pessoa logada vê; remoção apaga', async () => {
    await http().post(`/spaces/${roomId}/photos`).set(as('staff')).set('content-type', 'image/png').send(PNG).expect(403);
    const fake = await http()
      .post(`/spaces/${roomId}/photos`)
      .set(as('owner'))
      .set('content-type', 'image/png')
      .send(Buffer.from('<svg onload="alert(1)"></svg>'))
      .expect(422);
    expect(fake.body.message).toBe('Envie a foto em JPG, PNG ou WebP');
    // Tipo declarado diferente do conteúdo também é recusado.
    await http().post(`/spaces/${roomId}/photos`).set(as('owner')).set('content-type', 'image/jpeg').send(PNG).expect(422);

    const up = await http().post(`/spaces/${roomId}/photos`).set(as('owner')).set('content-type', 'image/png').send(PNG).expect(201);
    const photoId = up.body.id as string;

    const list = await http().get('/spaces').set(as('viewer')).expect(200);
    expect(list.body.find((s: { id: string }) => s.id === roomId).photos).toEqual([{ id: photoId, contentType: 'image/png', sortOrder: 0 }]);

    const img = await http()
      .get(`/spaces/${roomId}/photos/${photoId}`)
      .set(as('viewer'))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
    await http().get(`/spaces/${roomId}/photos/${photoId}`).expect(401);

    await http().delete(`/spaces/${roomId}/photos/${photoId}`).set(as('staff')).expect(403);
    await http().delete(`/spaces/${roomId}/photos/${photoId}`).set(as('owner')).expect(204);
    await http().get(`/spaces/${roomId}/photos/${photoId}`).set(as('viewer')).expect(404);
  });

  it('alugada mensal: devolve as reservas futuras e recusa reserva nova com o motivo', async () => {
    await http()
      .post('/bookings')
      .set(as('staff'))
      .send({ spaceId: roomId, startAt: `${day}T10:00:00-03:00`, endAt: `${day}T11:00:00-03:00`, title: 'Ensaio coral', responsibleName: 'Coral', responsiblePhone: '11955554444' })
      .expect(201);
    await http().patch(`/spaces/${roomId}`).set(as('staff')).send({ status: 'monthly_rental' }).expect(403);
    const res = await http().patch(`/spaces/${roomId}`).set(as('owner')).send({ status: 'monthly_rental' }).expect(200);
    expect(res.body.status).toBe('monthly_rental');
    expect(res.body.futureOccurrences.map((o: { booking: { title: string } }) => o.booking.title)).toEqual(['Ensaio coral']);

    const denied = await http()
      .post('/bookings')
      .set(as('staff'))
      .send({ spaceId: roomId, startAt: `${day}T14:00:00-03:00`, endAt: `${day}T15:00:00-03:00`, responsibleName: 'Coral', responsiblePhone: '11955554444' })
      .expect(422);
    expect(denied.body.message).toBe('A Sala Lilás está alugada mensalmente e não recebe reservas avulsas');
  });
});

describe('contatos', () => {
  let contactId: string;

  beforeAll(async () => {
    const inst = await prisma.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID() } });
    const group = await prisma.whatsappGroup.create({ data: { organizationId: orgId, instanceId: inst.id, externalGroupId: `${randomUUID()}-group`, name: 'PROJETO - XPO' } });
    const c = await prisma.contact.create({
      data: { organizationId: orgId, phone: '5511977770001', whatsappName: 'João Paulo', searchName: 'joao paulo', groups: { create: { groupId: group.id } } },
    });
    contactId = c.id;
    await prisma.contact.create({ data: { organizationId: orgId, phone: '5511977770002', whatsappName: 'Bia', searchName: 'bia' } });
  });

  it('busca por nome sem acento e por telefone; perfil leitura não vê telefones', async () => {
    await http().get('/contacts').set(as('viewer')).expect(403);
    const byName = await http().get('/contacts?q=JOAO').set(as('staff')).expect(200);
    expect(byName.body.total).toBe(1);
    expect(byName.body.items[0]).toMatchObject({ phone: '5511977770001', groups: [{ group: { name: 'PROJETO - XPO' } }] });
    const byPhone = await http().get('/contacts?q=70002').set(as('staff')).expect(200);
    expect(byPhone.body.items.map((c: { whatsappName: string }) => c.whatsappName)).toEqual(['Bia']);
    const groups = await http().get('/contacts/groups').set(as('owner')).expect(200);
    expect(groups.body).toEqual([expect.objectContaining({ name: 'PROJETO - XPO', members: 1 })]);
  });

  it('equipe corrige o nome e anota; outra organização não acessa', async () => {
    const res = await http().patch(`/contacts/${contactId}`).set(as('staff')).send({ name: 'João (produção)', notes: 'Produtor da XPO' }).expect(200);
    expect(res.body).toMatchObject({ name: 'João (produção)', notes: 'Produtor da XPO', whatsappName: 'João Paulo' });
    await http().patch(`/contacts/${contactId}`).set(as('viewer')).send({ name: 'x' }).expect(403);
    await http().get(`/contacts/${randomUUID()}`).set(as('owner')).expect(404);
  });
});

describe('conexão do WhatsApp pelo painel', () => {
  it('QR code e código de pareamento: só administração, sem cache, com auditoria', async () => {
    const { WHATSAPP_PROVIDER } = await import('../src/whatsapp/whatsapp.provider');
    const fake = app.get(WHATSAPP_PROVIDER) as { connected: boolean };

    expect((await http().get('/whatsapp/qr-code').set(as('owner')).expect(200)).body).toEqual({ kind: 'connected' });

    fake.connected = false;
    try {
      await http().get('/whatsapp/qr-code').set(as('staff')).expect(403);
      const qr = await http().get('/whatsapp/qr-code').set(as('owner')).expect(200);
      expect(qr.body.kind).toBe('qr');
      expect(qr.body.image).toMatch(/^data:image\//);
      expect(qr.headers['cache-control']).toBe('no-store');

      await http().post('/whatsapp/phone-code').set(as('owner')).send({ phone: '123' }).expect(400);
      const code = await http().post('/whatsapp/phone-code').set(as('owner')).send({ phone: '+55 11 90000-0000' }).expect(200);
      expect(code.body).toEqual({ kind: 'code', code: 'FAKE1234' });

      const audits = await prisma.auditEvent.findMany({ where: { organizationId: orgId, action: { startsWith: 'whatsapp.' } }, orderBy: { createdAt: 'asc' } });
      expect(audits.map((a) => a.action)).toEqual(['whatsapp.qr_code_requested', 'whatsapp.phone_code_requested']);
      expect(JSON.stringify(audits)).not.toContain('data:image');
    } finally {
      fake.connected = true;
    }
  });
});

describe('lembretes', () => {
  it('equipe cria "ligar para" um contato; leitura vê o lembrete sem telefones', async () => {
    const carla = await prisma.contact.create({ data: { organizationId: orgId, phone: '5511977770009', name: 'Carla', searchName: 'carla' } });
    const res = await http()
      .post('/reminders')
      .set(as('staff'))
      .send({ type: 'call', contactId: carla.id, dueAt: `${year}-03-05T14:00:00-03:00`, recipientPhones: ['5511900000001'] })
      .expect(201);
    expect(res.body).toMatchObject({ type: 'call', title: 'Ligar para Carla', contact: { phone: '5511977770009' } });

    const asViewer = await http().get('/reminders').set(as('viewer')).expect(200);
    const mine = asViewer.body.find((r: { id: string }) => r.id === res.body.id);
    expect(mine).toMatchObject({ title: 'Ligar para Carla', recipientPhones: [], contact: { phone: '' } });
    await http().post('/reminders').set(as('viewer')).send({ title: 'x', dueAt: `${year}-03-05T14:00:00-03:00`, recipientPhones: ['5511900000001'] }).expect(403);
    await http().post(`/reminders/${res.body.id}/deactivate`).set(as('staff')).expect(200);
  });

  it('automáticos das contas e equipe com WhatsApp para destinatários', async () => {
    await http()
      .post('/bills')
      .set(as('owner'))
      .send({ name: 'Telefone fixo', category: 'telefone', dueDay: 12, estimatedAmountCents: 9900, startsOn: `${new Date().getFullYear()}-01-01` })
      .expect(201);
    const auto = await http().get('/reminders/automatic').set(as('staff')).expect(200);
    expect(auto.body.map((a: { name: string }) => a.name)).toContain('Telefone fixo');
    await http().get('/organization/members').set(as('viewer')).expect(403);
    const members = await http().get('/organization/members').set(as('staff')).expect(200);
    expect(Array.isArray(members.body)).toBe(true);
  });
});

describe('desconectar o WhatsApp', () => {
  it('só administração; marca a instância como desconectada e audita', async () => {
    const { WHATSAPP_PROVIDER } = await import('../src/whatsapp/whatsapp.provider');
    const fake = app.get(WHATSAPP_PROVIDER) as { connected: boolean };
    await prisma.whatsappInstance.updateMany({ where: { organizationId: orgId }, data: { connected: true } });
    try {
      await http().post('/whatsapp/disconnect').set(as('staff')).expect(403);
      await http().post('/whatsapp/disconnect').set(as('owner')).expect(200, { connected: false });
      expect(fake.connected).toBe(false);
      const inst = await prisma.whatsappInstance.findFirstOrThrow({ where: { organizationId: orgId } });
      expect(inst).toMatchObject({ connected: false, lastError: 'desconectado pelo painel' });
      expect(await prisma.auditEvent.count({ where: { organizationId: orgId, action: 'whatsapp.disconnected_by_user' } })).toBe(1);
      // Desconectado, o painel recebe QR code para conectar de novo.
      expect((await http().get('/whatsapp/qr-code').set(as('owner')).expect(200)).body.kind).toBe('qr');
    } finally {
      fake.connected = true;
    }
  });
});

describe('entradas', () => {
  it('administração lança entrada de projeto e marca recebida; equipe e leitura só consultam', async () => {
    const project = await prisma.project.create({ data: { organizationId: orgId, title: 'Mostra', status: 'active' } });
    const month = `${year}-03`;
    await http().post('/incomes').set(as('staff')).send({ source: 'other', description: 'x', amountCents: 100, expectedOn: `${month}-10` }).expect(403);
    await http().post('/incomes').set(as('owner')).send({ source: 'project', description: 'Sem projeto', amountCents: 100, expectedOn: `${month}-10` }).expect(422);
    const inc = await http()
      .post('/incomes')
      .set(as('owner'))
      .send({ source: 'project', projectId: project.id, description: 'Patrocínio', amountCents: 300000, expectedOn: `${month}-15`, payerName: 'Empresa X' })
      .expect(201);
    expect(inc.body).toMatchObject({ status: 'expected', project: { title: 'Mostra' } });

    const list = await http().get(`/incomes?competence=${month}`).set(as('viewer')).expect(200);
    expect(list.body.map((i: { description: string }) => i.description)).toContain('Patrocínio');
    await http().get('/incomes?competence=2026-13').set(as('owner')).expect(400);

    await http().post(`/incomes/${inc.body.id}/receive`).set(as('owner')).send({ amountCents: 290000, receivedOn: `${month}-14` }).expect(200);
    await http().post(`/incomes/${inc.body.id}/receive`).set(as('owner')).send({}).expect(409);
    const summary = await http().get(`/incomes/summary?competence=${month}`).set(as('staff')).expect(200);
    expect(summary.body).toMatchObject({ receivedCents: 290000, received: 1 });
  });

  it('sala alugada com valor e dia: o aluguel do mês aparece nas entradas', async () => {
    const res = await http()
      .post('/spaces')
      .set(as('owner'))
      .send({ name: 'Sala do Jardim', status: 'monthly_rental', rentAmountCents: 150000, rentDueDay: 5, tenantName: 'Ateliê Barro' })
      .expect(201);
    const now = new Date();
    const competence = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const list = await http().get(`/incomes?competence=${competence}`).set(as('owner')).expect(200);
    expect(list.body.find((i: { spaceId: string }) => i.spaceId === res.body.id)).toMatchObject({
      source: 'room_rental',
      description: 'Aluguel Sala do Jardim',
      amountCents: 150000,
      payerName: 'Ateliê Barro',
    });
  });
});

describe('equipe', () => {
  it('administração cadastra admin com telefone (55 completado); duplicado recusado; leitura não acessa', async () => {
    const email = `julia-${randomUUID()}@coxia.test`;
    emails.push(email);
    await http().get('/organization/team').set(as('viewer')).expect(403);
    await http().post('/organization/team').set(as('staff')).send({ name: 'X', email: 'x@x.com', password: 'senha-forte-1' }).expect(403);
    const res = await http()
      .post('/organization/team')
      .set(as('owner'))
      .send({ name: 'Julia', email, phone: '(11) 98888-7777', role: 'admin', password: 'senha-inicial-1' })
      .expect(201);
    expect(res.body).toMatchObject({ role: 'admin', canManageProjects: true, user: { name: 'Julia', phone: '5511988887777' } });
    await http().post('/organization/team').set(as('owner')).send({ name: 'Outra', email, password: 'senha-inicial-1' }).expect(409);
    // A nova admin entra com a senha inicial e aparece na equipe.
    await http().post('/auth/login').send({ email, password: 'senha-inicial-1' }).expect(200);
    const team = await http().get('/organization/team').set(as('owner')).expect(200);
    expect(team.body.map((m: { user: { email: string } }) => m.user.email)).toContain(email);
  });

  it('cada um edita o próprio telefone; papel só a administração; telefone inválido é recusado', async () => {
    const me = await http().get('/auth/me').set(as('staff')).expect(200);
    const res = await http().patch(`/organization/team/${me.body.user.memberId}`).set(as('staff')).send({ phone: '11 97777-0001' }).expect(200);
    expect(res.body.user.phone).toBe('5511977770001');
    await http().patch(`/organization/team/${me.body.user.memberId}`).set(as('staff')).send({ role: 'admin' }).expect(403);
    await http().patch(`/organization/team/${me.body.user.memberId}`).set(as('staff')).send({ phone: '123' }).expect(400);
    const owner = await http().get('/auth/me').set(as('owner')).expect(200);
    await http().patch(`/organization/team/${owner.body.user.memberId}`).set(as('staff')).send({ name: 'Hack' }).expect(403);
    // A casa não fica sem responsável.
    await http().patch(`/organization/team/${owner.body.user.memberId}`).set(as('owner')).send({ role: 'admin' }).expect(422);
  });
});

describe('categorias de gasto e tipo da conta', () => {
  it('categorias iniciais, criação pela administração; conta pontual com categoria', async () => {
    const list = await http().get('/expense-categories').set(as('viewer')).expect(200);
    expect(list.body.map((c: { name: string }) => c.name)).toEqual(['Casa', 'Estoque', 'Manutenção']);
    await http().post('/expense-categories').set(as('staff')).send({ name: 'Eventos' }).expect(403);
    const ev = await http().post('/expense-categories').set(as('owner')).send({ name: 'Eventos', icon: 'eventos', color: 'ameixa' }).expect(201);
    await http().post('/expense-categories').set(as('owner')).send({ name: 'X', icon: 'foguete' }).expect(400);
    const bill = await http()
      .post('/bills')
      .set(as('owner'))
      .send({ kind: 'one_time', name: 'Cachê do técnico', expenseCategoryId: ev.body.id, dueOn: `${year}-02-15`, dueDay: 15, estimatedAmountCents: 80000, startsOn: `${year}-02-15` })
      .expect(201);
    expect(bill.body).toMatchObject({ kind: 'one_time', expenseCategoryId: ev.body.id });
    const occ = await http().get(`/bills/occurrences?competence=${year}-02`).set(as('owner')).expect(200);
    expect(occ.body.find((o: { recurringBill: { id: string } }) => o.recurringBill.id === bill.body.id).recurringBill.expenseCategory.name).toBe('Eventos');
  });
});
