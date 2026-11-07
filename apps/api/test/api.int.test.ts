/**
 * Integração da API com Postgres e Redis reais.
 * Golden Z-API: as fixtures de tests/fixtures/zapi passam pelo webhook completo.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Body, Controller, type INestApplication, Post } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { QUEUES } from '@coxia/contracts';
import { createPrismaClient } from '@coxia/database';
import { redisConnectionFromUrl } from '@coxia/config';
import bcrypt from 'bcryptjs';
import { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvModule } from '../src/app.module';
import { loadApiEnv } from '../src/config/env';
import { IdempotencyInterceptor } from '../src/idempotency/idempotency';
import { createApp } from '../src/main';
import { PrismaModule } from '../src/prisma/prisma.service';

const SECRET = 'test-webhook-secret-0123456789';
const INSTANCE = `inst-${randomUUID()}`;
const fixtures = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'zapi');

const env = loadApiEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  WHATSAPP_PROVIDER: 'zapi',
  ZAPI_INSTANCE_ID: INSTANCE,
  ZAPI_INSTANCE_TOKEN: 'test-token',
  ZAPI_WEBHOOK_SECRET: SECRET,
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-00',
  AI_SERVICE_TOKEN: 'test-ai-token-000000',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: 'coxia-media',
  S3_ACCESS_KEY_ID: 'coxia',
  S3_SECRET_ACCESS_KEY: 'coxia-dev-secret',
});

const prisma = createPrismaClient(env.DATABASE_URL);
const queue = new Queue(QUEUES.inbound, { connection: redisConnectionFromUrl(env.REDIS_URL) });
let app: INestApplication;
let orgId: string;
const email = `admin-${randomUUID()}@coxia.test`;
const staffEmail = `staff-${randomUUID()}@coxia.test`;

/** Carrega a fixture com o instanceId e os IDs de mensagem exclusivos deste teste. */
function fixture(name: string, runId: string): Record<string, unknown> {
  const p = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as Record<string, unknown>;
  return {
    ...p,
    instanceId: INSTANCE,
    ...(typeof p.messageId === 'string' ? { messageId: `${p.messageId}-${runId}` } : {}),
    phone: p.isGroup ? `${runId}-group` : p.phone,
  };
}

const webhook = (body: object, secret = SECRET) => request(app.getHttpServer()).post(`/webhooks/zapi/${secret}`).send(body);

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: 'Org API teste', slug: `api-${randomUUID()}` } });
  orgId = org.id;
  await prisma.whatsappInstance.create({ data: { organizationId: orgId, provider: 'zapi', externalInstanceId: INSTANCE } });
  const hash = await bcrypt.hash('senha-forte-123', 4);
  for (const [mail, role] of [[email, 'owner'], [staffEmail, 'staff']] as const) {
    const u = await prisma.user.create({ data: { email: mail, name: role, passwordHash: hash } });
    await prisma.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role } });
  }
  app = await createApp(env);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { in: [email, staffEmail] } } });
  await queue.close();
  await prisma.$disconnect();
});

describe('health', () => {
  it('liveness e readiness', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok', service: 'api' });
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body.checks).toEqual({ postgres: 'ok', redis: 'ok' });
  });
});

describe('golden: webhook Z-API', () => {
  it('segredo errado → 404 e nada é gravado', async () => {
    const run = randomUUID();
    await webhook(fixture('text-direct.json', run), 'wrong-secret').expect(404);
    expect(await prisma.message.count({ where: { organizationId: orgId, dedupeKey: { contains: run } } })).toBe(0);
  });

  it('mensagem aceita é persistida e enfileirada com jobId = message.id', async () => {
    const run = randomUUID();
    const res = await webhook(fixture('text-group-first-message.json', run)).expect(200);
    expect(res.body.status).toBe('accepted');
    const msg = await prisma.message.findUniqueOrThrow({ where: { id: res.body.messageId }, include: { conversation: { include: { group: true } } } });
    expect(msg.processingStatus).toBe('queued');
    expect(msg.senderPhone).toBe('5511977776666');
    expect(msg.conversation.group?.externalGroupId).toBe(`${run}-group`);
    expect(msg.conversation.group?.name).toBe('PROJETO - XPO');
    expect(await queue.getJob(msg.id)).toBeDefined();
  });

  it('reenvio do mesmo webhook não duplica (sequencial e concorrente)', async () => {
    const run = randomUUID();
    const body = fixture('image-group-receipt.json', run);
    const first = await webhook(body).expect(200);
    const again = await webhook(body).expect(200);
    expect(again.body).toEqual({ status: 'duplicate', messageId: first.body.messageId });

    const run2 = randomUUID();
    const body2 = fixture('document-group-quote.json', run2);
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(body2)));
    expect(results.filter((r) => r.body.status === 'accepted')).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.messageId)).size).toBe(1);
    const count = await prisma.message.count({ where: { dedupeKey: { contains: run2 } } });
    expect(count).toBe(1);
    expect(await prisma.messageAttachment.count({ where: { message: { dedupeKey: { contains: run2 } } } })).toBe(1);
  });

  it('renomear o grupo atualiza o nome e preserva a identidade', async () => {
    const run = randomUUID();
    await webhook(fixture('text-group-first-message.json', run)).expect(200);
    await webhook(fixture('text-group-after-rename.json', run)).expect(200);
    const groups = await prisma.whatsappGroup.findMany({ where: { externalGroupId: `${run}-group` } });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('PROJETO XPO renomeado');
    expect(await prisma.conversation.count({ where: { externalChatId: `${run}-group` } })).toBe(1);
  });

  it('mensagem fromMe é registrada como tal', async () => {
    const run = randomUUID();
    const res = await webhook(fixture('text-group-from-me.json', run)).expect(200);
    const msg = await prisma.message.findUniqueOrThrow({ where: { id: res.body.messageId } });
    expect(msg.fromMe).toBe(true);
  });

  it('áudio gera anexo pendente de download', async () => {
    const run = randomUUID();
    const res = await webhook(fixture('audio-group-briefing.json', run)).expect(200);
    const att = await prisma.messageAttachment.findFirstOrThrow({ where: { messageId: res.body.messageId } });
    expect(att).toMatchObject({ kind: 'audio', mimeType: 'audio/ogg; codecs=opus', durationSeconds: 94, storageKey: null });
  });

  it('callback de status e instância desconhecida são ignorados com 200', async () => {
    const status = await webhook(fixture('status-callback-ignored.json', randomUUID())).expect(200);
    expect(status.body).toEqual({ status: 'ignored', reason: 'not_a_message' });
    const unknown = await webhook({ ...fixture('text-direct.json', randomUUID()), instanceId: 'outra' }).expect(200);
    expect(unknown.body).toEqual({ status: 'ignored', reason: 'unknown_instance' });
    const invalid = await webhook({ type: 'ReceivedCallback' }).expect(200);
    expect(invalid.body).toEqual({ status: 'ignored', reason: 'invalid_payload' });
  });
});

describe('auth e RBAC', () => {
  const login = (mail: string, password = 'senha-forte-123') =>
    request(app.getHttpServer()).post('/auth/login').send({ email: mail, password });

  it('rotas protegidas exigem token', async () => {
    await request(app.getHttpServer()).get('/organization').expect(401);
    await request(app.getHttpServer()).get('/organization').set('authorization', 'Bearer lixo').expect(401);
  });

  it('senha errada → 401 sem revelar se o e-mail existe', async () => {
    const a = await login(email, 'errada').expect(401);
    const b = await login('ninguem@coxia.test', 'errada').expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('login → /auth/me e /organization', async () => {
    const res = await login(email.toUpperCase()).expect(200);
    const auth = { authorization: `Bearer ${res.body.accessToken}` };
    const me = await request(app.getHttpServer()).get('/auth/me').set(auth).expect(200);
    expect(me.body.user.role).toBe('owner');
    const org = await request(app.getHttpServer()).get('/organization').set(auth).expect(200);
    expect(org.body.timezone).toBe('America/Sao_Paulo');
  });

  it('staff não acessa a rota de conexão do WhatsApp (admin)', async () => {
    const res = await login(staffEmail).expect(200);
    await request(app.getHttpServer()).get('/whatsapp/connection').set('authorization', `Bearer ${res.body.accessToken}`).expect(403);
  });
});

describe('idempotência', () => {
  let echoApp: INestApplication;
  let calls = 0;

  @Controller('echo')
  class EchoController {
    @Post()
    echo(@Body() body: unknown) {
      calls += 1;
      return { call: calls, body };
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule.forRoot(env), PrismaModule],
      controllers: [EchoController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
    }).compile();
    echoApp = moduleRef.createNestApplication();
    await echoApp.init();
  });
  afterAll(() => echoApp?.close());

  it('mesma Idempotency-Key devolve a resposta original sem reexecutar; corpo diferente → 422', async () => {
    const key = randomUUID();
    const post = (body: object) => request(echoApp.getHttpServer()).post('/echo').set('idempotency-key', key).send(body);
    const a = await post({ valor: 1 }).expect(201);
    const b = await post({ valor: 1 }).expect(201);
    expect(b.body).toEqual(a.body);
    expect(calls).toBe(1);
    await post({ valor: 2 }).expect(422);
  });

  it('login (rota pública) nunca é armazenado', async () => {
    const key = randomUUID();
    await request(app.getHttpServer()).post('/auth/login').set('idempotency-key', key).send({ email, password: 'senha-forte-123' }).expect(200);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
  });
});
