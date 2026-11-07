import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadWorkerEnv } from './env';
import { WorkerModule } from './worker.module';

/**
 * Worker: consome as filas BullMQ (mensagens recebidas, manutenção/outbox) e expõe
 * /health na porta 3001 apenas para healthchecks (rede privada).
 */
async function bootstrap() {
  const env = loadWorkerEnv();
  const app = await NestFactory.create(WorkerModule.forRoot(env), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  // O Railway injeta PORT e faz o healthcheck nela.
  await app.listen(Number(process.env.PORT ?? process.env.WORKER_HEALTH_PORT ?? 3001), '::');
}

void bootstrap();
