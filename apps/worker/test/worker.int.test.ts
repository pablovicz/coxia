/**
 * Integração do worker com Postgres, Redis e MinIO reais.
 * Os processadores são chamados diretamente (sem esperar o BullMQ) para resultados determinísticos.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, enqueueDelivery } from '@coxia/database';
import { FakeWhatsappProvider, WhatsappProviderError } from '@coxia/shared';
import type { Job } from 'bullmq';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/env';
import { InboundProcessor } from '../src/inbound/inbound.processor';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { StorageService } from '../src/storage/storage.service';
import { WorkerModule } from '../src/worker.module';

process.env.WORKER_DISABLE_SCHEDULERS = 'true';

const env = loadWorkerEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  ZAPI_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
  AI_SERVICE_TOKEN: 'test-ai-token-000000',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: process.env.S3_BUCKET ?? 'coxia-media',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'coxia',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'coxia-dev-secret',
});

const prisma = createPrismaClient(env.DATABASE_URL);
const whatsapp = new FakeWhatsappProvider();
let app: INestApplication;
let orgId: string;
let instanceId: string;

const job = (messageId: string) =>
  ({ data: { messageId, organizationId: orgId, traceId: 't' }, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job;

async function createMessage(opts: { group?: string; senderPhone: string; fromMe?: boolean; media?: boolean }) {
  const chatId = opts.group ? `${randomUUID()}-group` : opts.senderPhone;
  const group = opts.group
    ? await prisma.whatsappGroup.create({ data: { organizationId: orgId, instanceId, externalGroupId: chatId, name: opts.group } })
    : null;
  const conv = await prisma.conversation.create({
    data: { organizationId: orgId, instanceId, externalChatId: chatId, isGroup: !!group, groupId: group?.id },
  });
  return prisma.message.create({
    data: {
      organizationId: orgId,
      conversationId: conv.id,
      direction: 'inbound',
      provider: 'fake',
      dedupeKey: `fake:${randomUUID()}`,
      kind: opts.media ? 'audio' : 'text',
      senderPhone: opts.senderPhone,
      fromMe: opts.fromMe ?? false,
      text: opts.media ? null : 'olá',
      sentAt: new Date(),
      processingStatus: 'queued',
      ...(opts.media
        ? { attachments: { create: { organizationId: orgId, kind: 'audio', mimeType: 'audio/ogg', sourceUrl: 'https://media.test/briefing.ogg' } } }
        : {}),
    },
  });
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: 'Org worker teste', slug: `wk-${randomUUID()}` } });
  orgId = org.id;
  instanceId = (await prisma.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID() } })).id;
  const admin = await prisma.user.create({ data: { name: 'Ana', phone: `55119${Date.now() % 100000000}` } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: admin.id, role: 'admin', canManageProjects: true } });
  (globalThis as { adminPhone?: string }).adminPhone = admin.phone!;
  whatsapp.media.set('https://media.test/briefing.ogg', { body: new TextEncoder().encode('OggS-fake-audio'), contentType: 'audio/ogg' });

  app = await NestFactory.create(WorkerModule.forRoot(env, { whatsapp, withSchedulers: false }), { logger: false });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { phone: (globalThis as { adminPhone?: string }).adminPhone } });
  await prisma.$disconnect();
});

const adminPhone = () => (globalThis as { adminPhone?: string }).adminPhone!;

describe('processamento de mensagens recebidas', () => {
  it('copia o áudio para o bucket com sha256 e tamanho', async () => {
    const msg = await createMessage({ group: 'PROJETO - XPO', senderPhone: adminPhone(), media: true });
    const route = await app.get(InboundProcessor).process(job(msg.id));
    expect(route).toEqual({ route: 'project_group_candidate', authorized: true });

    const att = await prisma.messageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
    expect(att.storageKey).toBe(`org/${orgId}/messages/${msg.id}/${att.id}`);
    expect(att.sizeBytes).toBe(15);
    expect(att.sha256).toMatch(/^[0-9a-f]{64}$/);

    const url = await app.get(StorageService).signedGetUrl(att.storageKey!);
    const res = await fetch(url);
    expect(await res.text()).toBe('OggS-fake-audio');

    const after = await prisma.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(after.processingStatus).toBe('processed');
  });

  it('reprocessar uma mensagem já processada não faz nada', async () => {
    const msg = await createMessage({ senderPhone: adminPhone() });
    await app.get(InboundProcessor).process(job(msg.id));
    expect(await app.get(InboundProcessor).process(job(msg.id))).toEqual({ route: 'skipped' });
  });

  it('participante não autorizado não ativa workspace; fromMe é ignorada', async () => {
    const m1 = await createMessage({ group: 'PROJETO - Festival', senderPhone: '5511900009999' });
    expect(await app.get(InboundProcessor).process(job(m1.id))).toEqual({ route: 'project_group_candidate', authorized: false });
    const m2 = await createMessage({ group: 'PROJETO - Festival', senderPhone: adminPhone(), fromMe: true });
    expect(await app.get(InboundProcessor).process(job(m2.id))).toEqual({ route: 'ignored', reason: 'from_me' });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: m2.id } })).processingStatus).toBe('ignored');
  });
});

describe('outbox', () => {
  it('envia pendentes uma única vez e trata falhas', async () => {
    const svc = app.get(MaintenanceService);
    // Limpa pendências de outros testes neste banco para medir só as deste.
    await prisma.notificationDelivery.updateMany({ where: { status: { in: ['pending', 'failed'] } }, data: { status: 'dead' } });

    const key = `t:${randomUUID()}`;
    await enqueueDelivery(prisma, { organizationId: orgId, recipient: adminPhone(), text: 'Bom dia! 2 reservas hoje.', idempotencyKey: key });
    const before = whatsapp.sent.length;
    const r1 = await svc.dispatchOutbox();
    expect(r1).toMatchObject({ claimed: 1, sent: 1 });
    expect(whatsapp.sent.length).toBe(before + 1);
    expect(await svc.dispatchOutbox()).toMatchObject({ claimed: 0 });

    const delivery = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(delivery.status).toBe('sent');
    expect(delivery.providerMessageId).toMatch(/^fake-/);

    // Falha retentável → failed com backoff; não retentável → dead-letter.
    const original = whatsapp.sendText.bind(whatsapp);
    whatsapp.sendText = async () => {
      throw new WhatsappProviderError('HTTP 400 número inválido', 400, false);
    };
    const badKey = `t:${randomUUID()}`;
    await enqueueDelivery(prisma, { organizationId: orgId, recipient: '0', text: 'x', idempotencyKey: badKey });
    expect(await svc.dispatchOutbox()).toMatchObject({ dead: 1 });
    whatsapp.sendText = original;
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: badKey } })).status).toBe('dead');
  });

  it('verificação de conexão atualiza a instância', async () => {
    whatsapp.connected = false;
    expect(await app.get(MaintenanceService).checkConnection()).toEqual({ connected: false });
    const inst = await prisma.whatsappInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(inst.connected).toBe(false);
    expect(inst.lastCheckedAt).not.toBeNull();
    whatsapp.connected = true;
  });
});
