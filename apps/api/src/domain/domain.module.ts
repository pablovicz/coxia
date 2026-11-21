import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Global,
  HttpStatus,
  Module,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  AppointmentService,
  BillingService,
  BookingService,
  CalendarService,
  ContactService,
  type DomainEventPublisher,
  FinanceService,
  ResidentAccountService,
  ResidentBookingService,
  ResidentContractService,
  ResidentService,
  DomainError,
  ExpenseCategoryService,
  IncomeService,
  ProjectService,
  QuoteRequestService,
  ReminderService,
  SpaceService,
} from '@coxia/domain';
import bcrypt from 'bcryptjs';
import { DOMAIN_EVENTS } from '../events/events.module';
import { ResidentController } from '../resident/resident.controller';
import { ContractsController } from './contracts.controller';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppointmentsController,
  BillsController,
  CalendarController,
  FinanceController,
  ResidentsController,
  BookingsController,
  ContactsController,
  ExpenseCategoriesController,
  IncomesController,
  OverviewController,
  ProjectsController,
  RemindersController,
  SpacesController,
} from './controllers';
import { PublicQuoteController, PublicSpacesController, QuoteRequestsController } from './quote-requests.controller';

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
    { provide: BookingService, inject: [PrismaService, DOMAIN_EVENTS], useFactory: (db: PrismaService, events: DomainEventPublisher) => new BookingService(db, events) },
    { provide: ResidentContractService, inject: [PrismaService, DOMAIN_EVENTS], useFactory: (db: PrismaService, events: DomainEventPublisher) => new ResidentContractService(db, events) },
    {
      provide: ResidentBookingService,
      inject: [PrismaService, BookingService, ResidentContractService, DOMAIN_EVENTS],
      useFactory: (db: PrismaService, bookings: BookingService, contracts: ResidentContractService, events: DomainEventPublisher) => new ResidentBookingService(db, bookings, contracts, events),
    },
    {
      provide: ResidentAccountService,
      inject: [PrismaService, DOMAIN_EVENTS],
      useFactory: (db: PrismaService, events: DomainEventPublisher) => new ResidentAccountService(db, { hash: (p) => bcrypt.hash(p, 12), compare: (p, h) => bcrypt.compare(p, h) }, events),
    },
    { provide: BillingService, inject: [PrismaService], useFactory: (db: PrismaService) => new BillingService(db) },
    { provide: ReminderService, inject: [PrismaService], useFactory: (db: PrismaService) => new ReminderService(db) },
    { provide: AppointmentService, inject: [PrismaService], useFactory: (db: PrismaService) => new AppointmentService(db) },
    { provide: CalendarService, inject: [PrismaService], useFactory: (db: PrismaService) => new CalendarService(db) },
    { provide: FinanceService, inject: [PrismaService], useFactory: (db: PrismaService) => new FinanceService(db) },
    { provide: ResidentService, inject: [PrismaService], useFactory: (db: PrismaService) => new ResidentService(db) },
    { provide: ProjectService, inject: [PrismaService], useFactory: (db: PrismaService) => new ProjectService(db) },
    { provide: ContactService, inject: [PrismaService], useFactory: (db: PrismaService) => new ContactService(db) },
    { provide: IncomeService, inject: [PrismaService], useFactory: (db: PrismaService) => new IncomeService(db) },
    { provide: ExpenseCategoryService, inject: [PrismaService], useFactory: (db: PrismaService) => new ExpenseCategoryService(db) },
    { provide: QuoteRequestService, inject: [PrismaService], useFactory: (db: PrismaService) => new QuoteRequestService(db) },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
  exports: [ResidentContractService, ResidentBookingService, ResidentAccountService, SpaceService, BookingService, BillingService, ReminderService, AppointmentService, CalendarService, FinanceService, ResidentService, ProjectService, ContactService, IncomeService, ExpenseCategoryService, QuoteRequestService],
})
export class DomainModule {}

@Module({
  controllers: [ContractsController, ResidentController, SpacesController, BookingsController, BillsController, RemindersController, AppointmentsController, CalendarController, FinanceController, ResidentsController, OverviewController, ProjectsController, ContactsController, IncomesController, ExpenseCategoriesController, QuoteRequestsController, PublicQuoteController, PublicSpacesController],
})
export class DomainHttpModule {}
