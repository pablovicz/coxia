import { BullModule } from '@nestjs/bullmq';
import { Controller, type DynamicModule, Get, HttpException, HttpStatus, Module } from '@nestjs/common';
import { redisConnectionFromUrl } from '@coxia/config';
import { QUEUES } from '@coxia/contracts';
import type { WhatsappProvider } from '@coxia/shared';
import { LoggerModule } from 'nestjs-pino';
import type { WorkerEnv } from './env';
import { GroupContactsService } from './inbound/group-contacts.service';
import { InboundProcessor } from './inbound/inbound.processor';
import { InfraModule, PrismaService, type WorkerAi } from './infra.module';
import { MaintenanceProcessor, MaintenanceScheduler } from './maintenance/maintenance.processor';
import { MaintenanceService } from './maintenance/maintenance.service';
import { StorageService } from './storage/storage.service';

@Controller('health')
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  live() {
    return { status: 'ok', service: 'worker' };
  }

  @Get('ready')
  async ready() {
    const postgres = await this.prisma.$queryRaw`SELECT 1`.then(() => 'ok', () => 'fail');
    const storage = (await this.storage.ping()) ? 'ok' : 'fail';
    const checks = { postgres, storage };
    if (Object.values(checks).includes('fail')) {
      throw new HttpException({ status: 'degraded', checks }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', checks };
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: WorkerEnv, overrides: { whatsapp?: WhatsappProvider; ai?: WorkerAi; withSchedulers?: boolean } = {}): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        InfraModule.forRoot(env, overrides),
        LoggerModule.forRoot({
          pinoHttp: { level: env.LOG_LEVEL, autoLogging: false },
        }),
        BullModule.forRoot({ connection: redisConnectionFromUrl(env.REDIS_URL) }),
        BullModule.registerQueue({ name: QUEUES.inbound }, { name: QUEUES.maintenance }),
      ],
      controllers: [HealthController],
      providers: [
        InboundProcessor,
        GroupContactsService,
        MaintenanceService,
        MaintenanceProcessor,
        ...(overrides.withSchedulers === false ? [] : [MaintenanceScheduler]),
      ],
    };
  }
}
