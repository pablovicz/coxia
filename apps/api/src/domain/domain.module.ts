import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Global,
  HttpStatus,
  Module,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppointmentService, BillingService, BookingService, CalendarService, ContactService, FinanceService, ResidentService, DomainError, ExpenseCategoryService, IncomeService, ProjectService, QuoteRequestService, ReminderService, SpaceService } from '@coxia/domain';
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
    { provide: BookingService, inject: [PrismaService], useFactory: (db: PrismaService) => new BookingService(db) },
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
  exports: [SpaceService, BookingService, BillingService, ReminderService, AppointmentService, CalendarService, FinanceService, ResidentService, ProjectService, ContactService, IncomeService, ExpenseCategoryService, QuoteRequestService],
})
export class DomainModule {}

@Module({
  controllers: [SpacesController, BookingsController, BillsController, RemindersController, AppointmentsController, CalendarController, FinanceController, ResidentsController, OverviewController, ProjectsController, ContactsController, IncomesController, ExpenseCategoriesController, QuoteRequestsController, PublicQuoteController, PublicSpacesController],
})
export class DomainHttpModule {}
