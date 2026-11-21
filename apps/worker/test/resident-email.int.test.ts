/**
 * E-mails dos residentes pelo outbox (fila própria, independente do WhatsApp) e job de contratos.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPrismaClient } from '@coxia/database';
import { type DomainEvent, enqueueResidentEmail } from '@coxia/domain';
import { FakeEmailProvider, FakeWhatsappProvider } from '@coxia/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/env';
import type { WorkerAi } from '../src/infra.module';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { WorkerModule } from '../src/worker.module';

process.env.WORKER_DISABLE_SCHEDULERS = 'true';

const env = loadWorkerEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  ZAPI_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
  AI_SERVICE_TOKEN: 'test-ai-token-000000',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: 'coxia-media',
  S3_ACCESS_KEY_ID: 'coxia',
  S3_SECRET_ACCESS_KEY: 'coxia-dev-secret',
  EMAIL_FROM: 'Casa Kaju <reservas@casakaju.com>',
  RESIDENT_APP_URL: 'https://residente.casakaju.com',
});

const prisma = createPrismaClient(env.DATABASE_URL);
const email = new FakeEmailProvider();
const events: DomainEvent[] = [];
const ai = {} as WorkerAi;
let app: INestApplication;
let maintenance: MaintenanceService;
let orgId: string;
const run = randomUUID().slice(0, 8);

beforeAll(async () => {
  app = await NestFactory.create(
    WorkerModule.forRoot(env, { whatsapp: new FakeWhatsappProvider(), ai, email, events: { publish: (e) => events.push(e) }, withSchedulers: false }),
    { logger: false },
  );
  await app.init();
  maintenance = app.get(MaintenanceService);
  orgId = (await prisma.organization.create({ data: { name: 'Casa Kaju', slug: `mail-${run}` } })).id;
  // WhatsApp desconectado: não pode segurar os e-mails.
  await prisma.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: `i-${run}`, connected: false, lastCheckedAt: new Date() } });
});

afterAll(async () => {
  await app?.close();
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe('e-mails do residente', () => {
  it('convite de acesso: envia com o link e apaga o token do outbox', async () => {
    await enqueueResidentEmail(prisma, orgId, `lume-${run}@res.test`, { template: 'access', purpose: 'invite', residentName: 'Coletivo Lume', organizationName: 'Casa Kaju', token: 'tok-123' }, `test_invite:${run}`);
    const res = await maintenance.dispatchEmailOutbox(50);
    expect(res.sent).toBeGreaterThanOrEqual(1);
    const mail = email.sent.find((m) => m.to === `lume-${run}@res.test`)!;
    expect(mail.subject).toContain('Seu acesso');
    expect(mail.html).toContain('https://residente.casakaju.com/definir-senha?token=tok-123');
    const d = await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: `test_invite:${run}` } });
    expect(d.status).toBe('sent');
    expect((d.payload as { token: string }).token).toBe('[enviado]');
  });

  it('convite de reserva leva o .ics e o link de check-in', async () => {
    await enqueueResidentEmail(
      prisma,
      orgId,
      `lume-${run}@res.test`,
      {
        template: 'booking',
        method: 'REQUEST',
        occurrenceId: `occ-${run}`,
        sequence: 0,
        startAt: '2026-11-24T17:00:00.000Z',
        endAt: '2026-11-24T21:00:00.000Z',
        spaceName: 'Sala Média',
        residentName: 'Coletivo Lume',
        organizationName: 'Casa Kaju',
        timezone: 'America/Sao_Paulo',
      },
      `test_booking:${run}`,
    );
    await maintenance.dispatchEmailOutbox(50);
    const mail = email.sent.find((m) => m.subject.includes('Reserva confirmada') && m.html.includes(`occ-${run}`))!;
    expect(mail.subject).toBe('Reserva confirmada: Sala Média · 24/11 14:00');
    expect(mail.html).toContain(`https://residente.casakaju.com/reservas/occ-${run}/check-in`);
    expect(mail.attachments?.[0]).toMatchObject({ filename: 'reserva.ics', contentType: 'text/calendar; charset=utf-8; method=REQUEST' });
    expect(mail.attachments?.[0]?.content).toContain(`UID:occ-${run}@casakaju.com`);
  });

  it('o despacho do WhatsApp não pega e-mails', async () => {
    await enqueueResidentEmail(prisma, orgId, `x-${run}@res.test`, { template: 'access', purpose: 'reset', residentName: 'X', organizationName: 'Casa Kaju', token: 't' }, `test_reset:${run}`);
    await maintenance.dispatchOutbox(50);
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: `test_reset:${run}` } })).status).toBe('pending');
    await maintenance.dispatchEmailOutbox(50);
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { idempotencyKey: `test_reset:${run}` } })).status).toBe('sent');
  });
});

describe('job de contratos', () => {
  it('concede o ciclo e publica o evento para as telas', async () => {
    const contact = await prisma.contact.create({ data: { organizationId: orgId, phone: `5541${run.replace(/\D/g, '1').slice(0, 9).padEnd(9, '3')}`, kind: 'resident' } });
    const resident = await prisma.resident.create({ data: { organizationId: orgId, contactId: contact.id, name: 'Coletivo Lume' } });
    const space = await prisma.space.create({ data: { organizationId: orgId, name: 'Sala', slug: `sala-${run}` } });
    const c = await prisma.residentContract.create({
      data: { organizationId: orgId, residentId: resident.id, spaceId: space.id, monthlyMinutes: 600, cycleDay: 1, bookingOpensDay: 25, startsOn: new Date('2026-01-01T00:00:00Z') },
    });
    events.length = 0;
    await maintenance.runContractHours(new Date('2026-11-21T13:00:00Z'));
    expect(await prisma.hourGrant.count({ where: { contractId: c.id } })).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'hours.changed', contractId: c.id, residentId: resident.id }));
  });
});
