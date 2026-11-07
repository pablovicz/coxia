import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { MAINTENANCE_JOBS, type MaintenanceJobName, QUEUES } from '@coxia/contracts';
import type { Job, Queue } from 'bullmq';
import { MaintenanceService } from './maintenance.service';

/** Agenda os jobs periódicos (idempotente: upsertJobScheduler substitui o anterior). */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(@InjectQueue(QUEUES.maintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.WORKER_DISABLE_SCHEDULERS === 'true') return;
    const schedules: Array<[MaintenanceJobName, number]> = [
      [MAINTENANCE_JOBS.dispatchOutbox, 5_000],
      [MAINTENANCE_JOBS.reconcileInbound, 60_000],
      [MAINTENANCE_JOBS.checkConnection, 5 * 60_000],
      [MAINTENANCE_JOBS.runNotifications, 60_000],
      [MAINTENANCE_JOBS.generateBillOccurrences, 6 * 60 * 60_000],
      [MAINTENANCE_JOBS.extendBookingSeries, 24 * 60 * 60_000],
      [MAINTENANCE_JOBS.applyRetention, 24 * 60 * 60_000],
    ];
    for (const [name, every] of schedules) {
      await this.queue.upsertJobScheduler(name, { every }, { name, opts: { removeOnComplete: 100, removeOnFail: 500 } });
    }
    this.logger.log({ schedules: schedules.map(([n]) => n) }, 'jobs periódicos agendados');
    // Também ao subir: um deploy no dia 1º não espera 6h para gerar as contas do mês.
    await this.queue.add(MAINTENANCE_JOBS.generateBillOccurrences, {}, { removeOnComplete: 100, removeOnFail: 500 });
  }
}

@Processor(QUEUES.maintenance, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  constructor(private readonly maintenance: MaintenanceService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name as MaintenanceJobName) {
      case MAINTENANCE_JOBS.dispatchOutbox:
        return this.maintenance.dispatchOutbox();
      case MAINTENANCE_JOBS.reconcileInbound:
        return this.maintenance.reconcileInbound();
      case MAINTENANCE_JOBS.checkConnection:
        return this.maintenance.checkConnection();
      case MAINTENANCE_JOBS.runNotifications:
        return this.maintenance.runNotifications();
      case MAINTENANCE_JOBS.generateBillOccurrences:
        return this.maintenance.generateBillOccurrences();
      case MAINTENANCE_JOBS.extendBookingSeries:
        return this.maintenance.extendBookingSeries();
      case MAINTENANCE_JOBS.applyRetention:
        return this.maintenance.applyRetention();
      default:
        throw new Error(`job de manutenção desconhecido: ${job.name}`);
    }
  }
}
