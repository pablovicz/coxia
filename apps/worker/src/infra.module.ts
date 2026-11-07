import { type DynamicModule, Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@coxia/database';
import { FakeWhatsappProvider, type WhatsappProvider, ZapiProvider } from '@coxia/shared';
import { WORKER_ENV, type WorkerEnv } from './env';
import { StorageService } from './storage/storage.service';

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

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

/** Configuração, banco, provedor de WhatsApp e storage — compartilhados por todos os processadores. */
@Global()
@Module({})
export class InfraModule {
  static forRoot(env: WorkerEnv, overrides: { whatsapp?: WhatsappProvider } = {}): DynamicModule {
    return {
      module: InfraModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        PrismaService,
        StorageService,
        { provide: WHATSAPP_PROVIDER, useValue: overrides.whatsapp ?? createWhatsappProvider(env) },
      ],
      exports: [WORKER_ENV, PrismaService, StorageService, WHATSAPP_PROVIDER],
    };
  }
}
