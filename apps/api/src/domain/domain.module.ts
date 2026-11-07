import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Global,
  HttpStatus,
  Module,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BillingService, BookingService, DomainError, ReminderService, SpaceService } from '@coxia/domain';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  BillsController,
  BookingsController,
  OverviewController,
  RemindersController,
  SpacesController,
} from './controllers';

const STATUS: Record<DomainError['code'], number> = {
  not_found: HttpStatus.NOT_FOUND,
  validation: HttpStatus.UNPROCESSABLE_ENTITY,
  conflict: HttpStatus.CONFLICT,
  forbidden: HttpStatus.FORBIDDEN,
};

/** Erros de regra de negócio viram respostas HTTP com código e detalhes (ex.: lista de conflitos). */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(err: DomainError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(STATUS[err.code]).json({ statusCode: STATUS[err.code], code: err.code, message: err.message, details: err.details ?? null });
  }
}

@Global()
@Module({
  providers: [
    { provide: SpaceService, inject: [PrismaService], useFactory: (db: PrismaService) => new SpaceService(db) },
    { provide: BookingService, inject: [PrismaService], useFactory: (db: PrismaService) => new BookingService(db) },
    { provide: BillingService, inject: [PrismaService], useFactory: (db: PrismaService) => new BillingService(db) },
    { provide: ReminderService, inject: [PrismaService], useFactory: (db: PrismaService) => new ReminderService(db) },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
  exports: [SpaceService, BookingService, BillingService, ReminderService],
})
export class DomainModule {}

@Module({
  controllers: [SpacesController, BookingsController, BillsController, RemindersController, OverviewController],
})
export class DomainHttpModule {}
