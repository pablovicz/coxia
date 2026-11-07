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
import type { WorkerAi } from '../src/infra.module';
import type { InterpretCommandResponse } from '@coxia/contracts';

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
/** IA simulada: comandos por texto exato; transcrição fixa. */
const commandsByText = new Map<string, InterpretCommandResponse['command']>();
const aiMeta = { executionId: 'stub', model: 'stub', promptVersion: 'commands@test', parserVersion: '1', inputTokens: 0, outputTokens: 0, latencyMs: 0 };
const transcribed: string[] = [];
const ai: WorkerAi = {
  async interpretCommand(req) {
    return { command: commandsByText.get(req.text) ?? { intent: 'none' }, confidence: 0.95, clarificationQuestion: null, meta: aiMeta };
  },
  async transcribe(req) {
    transcribed.push(req.mediaUrl);
    return { text: 'Paguei a internet', durationSeconds: 3, meta: aiMeta };
  },
};
let app: INestApplication;
let orgId: string;
let instanceId: string;

const job = (messageId: string) =>
  ({ data: { messageId, organizationId: orgId, traceId: 't' }, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job;

async function createMessage(opts: { group?: string; senderPhone: string; fromMe?: boolean; media?: boolean; text?: string | null; mediaKind?: string }) {
  const chatId = opts.group ? `${randomUUID()}-group` : opts.senderPhone;
  const group = opts.group
    ? await prisma.whatsappGroup.create({ data: { organizationId: orgId, instanceId, externalGroupId: chatId, name: opts.group } })
    : null;
  const conv = await prisma.conversation.upsert({
    where: { instanceId_externalChatId: { instanceId, externalChatId: chatId } },
    update: {},
    create: { organizationId: orgId, instanceId, externalChatId: chatId, isGroup: !!group, groupId: group?.id },
  });
  return prisma.message.create({
    data: {
      organizationId: orgId,
      conversationId: conv.id,
      direction: 'inbound',
      provider: 'fake',
      dedupeKey: `fake:${randomUUID()}`,
      kind: opts.media ? (opts.mediaKind ?? 'audio') : 'text',
      senderPhone: opts.senderPhone,
      fromMe: opts.fromMe ?? false,
      text: opts.text !== undefined ? opts.text : opts.media ? null : 'olá',
      sentAt: new Date(),
      processingStatus: 'queued',
      ...(opts.media
        ? { attachments: { create: { organizationId: orgId, kind: opts.mediaKind ?? 'audio', mimeType: opts.mediaKind === 'image' ? 'image/jpeg' : 'audio/ogg', sourceUrl: opts.mediaKind === 'image' ? 'https://media.test/comprovante.jpg' : 'https://media.test/briefing.ogg' } } }
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

  app = await NestFactory.create(WorkerModule.forRoot(env, { whatsapp, ai, withSchedulers: false }), { logger: false });
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

describe('comandos de admin pelo WhatsApp (Etapa 2)', () => {
  it('reserva por texto: resposta sai pelo outbox para a conversa, uma única vez', async () => {
    const space = await prisma.space.create({ data: { organizationId: orgId, name: 'Sala Grande', slug: `sg-${randomUUID()}` } });
    const text = 'Reserva a sala grande sexta das 14h às 17h';
    commandsByText.set(text, {
      intent: 'booking.create',
      spaceHint: 'sala grande',
      startAt: '2027-03-05T14:00:00-03:00',
      endAt: '2027-03-05T17:00:00-03:00',
      responsibleName: null,
      notes: null,
      recurrence: null,
    });
    const msg = await createMessage({ senderPhone: adminPhone(), text });
    await app.get(InboundProcessor).process(job(msg.id));

    const reply = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: `reply:${msg.id}` } });
    expect(reply.recipient).toBe(adminPhone());
    expect(reply.text).toBe('Reservado: Sala Grande, sex, 05/03, 14h–17h.');
    expect(await prisma.bookingOccurrence.count({ where: { spaceId: space.id } })).toBe(1);
  });

  it('áudio do admin é transcrito (URL assinada do bucket) e vira comando com comprovante', async () => {
    await prisma.recurringBill.create({
      data: { organizationId: orgId, name: 'Internet', category: 'internet', dueDay: 20, estimatedAmountCents: 14990, startsOn: new Date('2026-01-01') },
    });
    await app.get(MaintenanceService).generateBillOccurrences();
    commandsByText.set('Paguei a internet', { intent: 'bill.mark_paid', billHint: 'internet', amountCents: null, paidOn: null });

    const msg = await createMessage({ senderPhone: adminPhone(), media: true });
    await app.get(InboundProcessor).process(job(msg.id));
    expect(transcribed.at(-1)).toMatch(/X-Amz-Signature=/);
    const att = await prisma.messageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
    expect(att.transcript).toBe('Paguei a internet');
    const reply = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: `reply:${msg.id}` } });
    expect(reply.text).toMatch(/^Anotado: Internet de .+ paga \(R\$ 149,90\)\.$/);
  });

  it('comprovante em imagem com legenda fica vinculado ao pagamento', async () => {
    await prisma.recurringBill.create({
      data: { organizationId: orgId, name: 'Água', category: 'agua', dueDay: 15, estimatedAmountCents: 9000, startsOn: new Date('2026-01-01') },
    });
    await app.get(MaintenanceService).generateBillOccurrences();
    whatsapp.media.set('https://media.test/comprovante.jpg', { body: new TextEncoder().encode(`jpeg-${randomUUID()}`), contentType: 'image/jpeg' });
    commandsByText.set('paguei a água', { intent: 'bill.mark_paid', billHint: 'água', amountCents: 9000, paidOn: null });

    const msg = await createMessage({ senderPhone: adminPhone(), media: true, mediaKind: 'image', text: 'paguei a água' });
    await app.get(InboundProcessor).process(job(msg.id));
    const att = await prisma.messageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
    const payment = await prisma.paymentAttachment.findFirstOrThrow({ where: { messageAttachmentId: att.id } });
    expect(payment.sha256).toBe(att.sha256);
    expect(payment.storageKey).toBe(att.storageKey);
  });

  it('jobs: geração de contas idempotente e notificações planejadas', async () => {
    const svc = app.get(MaintenanceService);
    await svc.generateBillOccurrences();
    expect((await svc.generateBillOccurrences()).created).toBe(0);
    const r = await svc.runNotifications(new Date('2027-03-05T12:00:00Z'));
    expect(r.failed).toBe(0);
    expect((await svc.extendBookingSeries()).series).toBeGreaterThanOrEqual(0);
  });
});
