import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { redisConnectionFromUrl } from '@coxia/config';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { DomainHttpModule, DomainModule } from './domain/domain.module';
import { redactUrl, REDACTED_PATHS } from './common/log-redaction';
import { API_ENV, type ApiEnv } from './config/env';
import { HealthModule } from './health/health.controller';
import { IdempotencyInterceptor } from './idempotency/idempotency';
import { OpsModule } from './ops/ops.module';
import { OrganizationModule } from './organization/organization.module';
import { PrismaModule } from './prisma/prisma.service';
import { StorageModule } from './storage/storage.service';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Global()
@Module({})
export class EnvModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return { module: EnvModule, providers: [{ provide: API_ENV, useValue: env }], exports: [API_ENV] };
  }
}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            // trace_id correlaciona logs da api, worker e IA.
            genReqId: (req, res) => {
              const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            customProps: (req) => ({ trace_id: req.id }),
            redact: REDACTED_PATHS,
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: redactUrl(req.url) }),
            },
            autoLogging: { ignore: (req) => req.url === '/health' },
          },
        }),
        BullModule.forRoot({ connection: redisConnectionFromUrl(env.REDIS_URL) }),
        PrismaModule,
        StorageModule,
        AuditModule,
        AuthModule,
        HealthModule,
        WhatsappModule,
        OrganizationModule,
        DomainModule,
        DomainHttpModule,
        OpsModule,
      ],
      providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
    };
  }
}
