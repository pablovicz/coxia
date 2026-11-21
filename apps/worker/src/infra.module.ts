import { type DynamicModule, Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@coxia/database';
import { redisConnectionFromUrl } from '@coxia/config';
import { EVENTS_CHANNEL } from '@coxia/contracts';
import {
  BillingService,
  BookingService,
  type CommandInterpreter,
  CommandService,
  type DomainEvent,
  type DomainEventPublisher,
  NotificationService,
  type ProjectAi,
  ProjectService,
  ProjectWorkspaceService,
  ResidentContractService,
} from '@coxia/domain';
import { AiClient, type EmailProvider, FakeEmailProvider, FakeWhatsappProvider, ResendEmailProvider, type WhatsappProvider, ZapiProvider } from '@coxia/shared';
import { Redis } from 'ioredis';
import { WORKER_ENV, type WorkerEnv } from './env';
import { StorageService } from './storage/storage.service';

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
export const AI_CLIENT = Symbol('AI_CLIENT');
export const COMMAND_INTERPRETER = Symbol('COMMAND_INTERPRETER');
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const DOMAIN_EVENTS = Symbol('DOMAIN_EVENTS');

/** Eventos de atualização para as telas abertas: publica no Redis; a api entrega por SSE. */
export class RedisEventPublisher implements DomainEventPublisher, OnModuleDestroy {
  private readonly redis: Redis;
  constructor(url: string) {
    this.redis = new Redis({ ...redisConnectionFromUrl(url), maxRetriesPerRequest: 3 });
    this.redis.on('error', () => undefined);
  }
  publish(event: DomainEvent) {
    this.redis.publish(EVENTS_CHANNEL, JSON.stringify(event)).catch(() => undefined);
  }
  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}

export function createEmailProvider(env: WorkerEnv): EmailProvider {
  if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('EMAIL_PROVIDER=resend exige RESEND_API_KEY');
    return new ResendEmailProvider(env.RESEND_API_KEY);
  }
  return new FakeEmailProvider();
}

/** Partes do cliente de IA usadas pelo worker (permite stub nos testes). */
export type WorkerAi = Pick<AiClient, 'transcribe' | 'interpretCommand' | 'extractBriefing' | 'extractProjectEvents'>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(WORKER_ENV) env: WorkerEnv) {
    super({ datasources: { db: { url: env.DATABASE_URL } } });
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export function createWhatsappProvider(env: WorkerEnv): WhatsappProvider {
  if (env.WHATSAPP_PROVIDER === 'zapi') {
    return new ZapiProvider({
      baseUrl: env.ZAPI_BASE_URL,
      instanceId: env.ZAPI_INSTANCE_ID,
      instanceToken: env.ZAPI_INSTANCE_TOKEN,
      clientToken: env.ZAPI_CLIENT_TOKEN,
    });
  }
  return new FakeWhatsappProvider();
}

/** Configuração, banco, WhatsApp, IA, storage e serviços de domínio compartilhados pelos processadores. */
@Global()
@Module({})
export class InfraModule {
  static forRoot(env: WorkerEnv, overrides: { whatsapp?: WhatsappProvider; ai?: WorkerAi; email?: EmailProvider; events?: DomainEventPublisher } = {}): DynamicModule {
    const ai: WorkerAi = overrides.ai ?? new AiClient({ baseUrl: env.AI_SERVICE_URL, token: env.AI_SERVICE_TOKEN, timeoutMs: env.AI_TIMEOUT_MS });
    const interpreter: CommandInterpreter = { interpret: (req, key) => ai.interpretCommand(req, key) };
    const projectAi: ProjectAi = {
      extractBriefing: (req, key) => ai.extractBriefing(req, key),
      extractProjectEvents: (req, key) => ai.extractProjectEvents(req, key),
    };
    return {
      module: InfraModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        PrismaService,
        StorageService,
        { provide: WHATSAPP_PROVIDER, useValue: overrides.whatsapp ?? createWhatsappProvider(env) },
        { provide: AI_CLIENT, useValue: ai },
        { provide: COMMAND_INTERPRETER, useValue: interpreter },
        { provide: EMAIL_PROVIDER, useValue: overrides.email ?? createEmailProvider(env) },
        { provide: DOMAIN_EVENTS, useFactory: () => overrides.events ?? new RedisEventPublisher(env.REDIS_URL) },
        {
          provide: CommandService,
          inject: [PrismaService, COMMAND_INTERPRETER, DOMAIN_EVENTS],
          useFactory: (db: PrismaService, i: CommandInterpreter, events: DomainEventPublisher) => new CommandService(db, i, events),
        },
        { provide: ResidentContractService, inject: [PrismaService, DOMAIN_EVENTS], useFactory: (db: PrismaService, events: DomainEventPublisher) => new ResidentContractService(db, events) },
        { provide: NotificationService, inject: [PrismaService], useFactory: (db: PrismaService) => new NotificationService(db) },
        { provide: BillingService, inject: [PrismaService], useFactory: (db: PrismaService) => new BillingService(db) },
        { provide: BookingService, inject: [PrismaService, DOMAIN_EVENTS], useFactory: (db: PrismaService, events: DomainEventPublisher) => new BookingService(db, events) },
        { provide: ProjectService, inject: [PrismaService], useFactory: (db: PrismaService) => new ProjectService(db) },
        { provide: ProjectWorkspaceService, inject: [PrismaService], useFactory: (db: PrismaService) => new ProjectWorkspaceService(db, projectAi) },
      ],
      exports: [
        WORKER_ENV,
        PrismaService,
        StorageService,
        WHATSAPP_PROVIDER,
        AI_CLIENT,
        EMAIL_PROVIDER,
        DOMAIN_EVENTS,
        ResidentContractService,
        CommandService,
        NotificationService,
        BillingService,
        BookingService,
        ProjectService,
        ProjectWorkspaceService,
      ],
    };
  }
}
