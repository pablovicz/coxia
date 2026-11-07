import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadApiEnv, type ApiEnv } from './config/env';

export async function createApp(env: ApiEnv): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    rawBody: false,
  });
  app.useLogger(app.get(Logger));
  // Atrás do proxy do Railway: req.ip é o cliente (limite de login por IP), não o proxy.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: false,
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
  });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const env = loadApiEnv();
  const app = await createApp(env);
  // "::" escuta IPv4 e IPv6 (rede privada do Railway é IPv6).
  await app.listen(env.PORT, '::');
}

if (require.main === module) {
  void bootstrap();
}
