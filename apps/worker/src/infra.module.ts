import { type DynamicModule, Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@coxia/database';
import { BillingService, BookingService, type CommandInterpreter, CommandService, NotificationService } from '@coxia/domain';
import { AiClient, FakeWhatsappProvider, type WhatsappProvider, ZapiProvider } from '@coxia/shared';
import { WORKER_ENV, type WorkerEnv } from './env';
import { StorageService } from './storage/storage.service';

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
export const AI_CLIENT = Symbol('AI_CLIENT');
export const COMMAND_INTERPRETER = Symbol('COMMAND_INTERPRETER');

/** Partes do cliente de IA usadas pelo worker (permite stub nos testes). */
export type WorkerAi = Pick<AiClient, 'transcribe' | 'interpretCommand'>;

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
  static forRoot(env: WorkerEnv, overrides: { whatsapp?: WhatsappProvider; ai?: WorkerAi } = {}): DynamicModule {
    const ai: WorkerAi = overrides.ai ?? new AiClient({ baseUrl: env.AI_SERVICE_URL, token: env.AI_SERVICE_TOKEN, timeoutMs: env.AI_TIMEOUT_MS });
    const interpreter: CommandInterpreter = { interpret: (req, key) => ai.interpretCommand(req, key) };
    return {
      module: InfraModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        PrismaService,
        StorageService,
        { provide: WHATSAPP_PROVIDER, useValue: overrides.whatsapp ?? createWhatsappProvider(env) },
        { provide: AI_CLIENT, useValue: ai },
        { provide: COMMAND_INTERPRETER, useValue: interpreter },
        { provide: CommandService, inject: [PrismaService, COMMAND_INTERPRETER], useFactory: (db: PrismaService, i: CommandInterpreter) => new CommandService(db, i) },
        { provide: NotificationService, inject: [PrismaService], useFactory: (db: PrismaService) => new NotificationService(db) },
        { provide: BillingService, inject: [PrismaService], useFactory: (db: PrismaService) => new BillingService(db) },
        { provide: BookingService, inject: [PrismaService], useFactory: (db: PrismaService) => new BookingService(db) },
      ],
      exports: [WORKER_ENV, PrismaService, StorageService, WHATSAPP_PROVIDER, AI_CLIENT, CommandService, NotificationService, BillingService, BookingService],
    };
  }
}
