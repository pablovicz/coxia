import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, HttpException, HttpStatus, Module } from '@nestjs/common';
import { QUEUES } from '@coxia/contracts';
import { BullModule } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.inbound) private readonly queue: Queue,
  ) {}

  /** Liveness: o processo responde. Usado pelo healthcheck do Railway/Compose. */
  @Public()
  @Get()
  live() {
    return { status: 'ok', service: 'api' };
  }

  /** Readiness: dependências acessíveis. */
  @Public()
  @Get('ready')
  async ready() {
    const checks: Record<string, 'ok' | 'fail'> = {};
    await this.prisma.$queryRaw`SELECT 1`.then(
      () => (checks.postgres = 'ok'),
      () => (checks.postgres = 'fail'),
    );
    await this.queue.getJobCounts('waiting').then(
      () => (checks.redis = 'ok'),
      () => (checks.redis = 'fail'),
    );
    const ok = Object.values(checks).every((v) => v === 'ok');
    if (!ok) throw new HttpException({ status: 'degraded', checks }, HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'ok', checks };
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.inbound })],
  controllers: [HealthController],
})
export class HealthModule {}
