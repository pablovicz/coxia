import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  BillingService,
  BookingService,
  competenceOf,
  ProjectService,
  ReminderService,
  SpaceService,
} from '@coxia/domain';
import { addDays, localDateOf, localDayBoundsUtc } from '@coxia/shared';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import {
  availabilitySchema,
  billSchema,
  blockSchema,
  cancelSeriesSchema,
  competence,
  createBookingSchema,
  eventReviewSchema,
  expenseReviewSchema,
  isoDate,
  paymentSchema,
  projectPatchSchema,
  rangeQuery,
  reminderSchema,
  spaceSchema,
  taskPatchSchema,
  taskSchema,
  updateOccurrenceSchema,
  updateSeriesSchema,
  webActor,
} from './schemas';

const v = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);

// ───────────────────────── Salas ─────────────────────────

@Controller('spaces')
export class SpacesController {
  constructor(private readonly spaces: SpaceService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('includeInactive') includeInactive?: string) {
    return this.spaces.list(user.organizationId, includeInactive === 'true');
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(spaceSchema)) body: z.infer<typeof spaceSchema>) {
    return this.spaces.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(v(spaceSchema.partial().extend({ active: z.boolean().optional() }))) body: Partial<z.infer<typeof spaceSchema>> & { active?: boolean },
  ) {
    return this.spaces.update(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Put(':id/availability')
  setAvailability(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(availabilitySchema)) body: z.infer<typeof availabilitySchema>) {
    return this.spaces.setAvailability(user.organizationId, id, body.rules, webActor(user));
  }

  @Get('blocks')
  blocks(@CurrentUser() user: AuthUser, @Query(v(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.spaces.listBlocks(user.organizationId, q.from, q.to, q.spaceId);
  }

  @Roles('owner', 'admin')
  @Post(':id/blocks')
  addBlock(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(blockSchema)) body: z.infer<typeof blockSchema>) {
    return this.spaces.addBlock(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Delete('blocks/:blockId')
  @HttpCode(204)
  async removeBlock(@CurrentUser() user: AuthUser, @Param('blockId') blockId: string) {
    await this.spaces.removeBlock(user.organizationId, blockId, webActor(user));
  }
}

// ───────────────────────── Reservas ─────────────────────────

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingService) {}

  @Get('bookings')
  list(@CurrentUser() user: AuthUser, @Query(v(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.bookings.listOccurrences(user.organizationId, q.from, q.to, { spaceId: q.spaceId });
  }

  @Get('availability')
  availability(@CurrentUser() user: AuthUser, @Query(v(z.object({ date: isoDate, spaceId: z.string().optional() }))) q: { date: string; spaceId?: string }) {
    return this.bookings.availability(user.organizationId, q.date, { spaceId: q.spaceId });
  }

  @Roles('owner', 'admin', 'staff')
  @Post('bookings')
  create(@CurrentUser() user: AuthUser, @Body(v(createBookingSchema)) body: z.infer<typeof createBookingSchema>) {
    return this.bookings.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Patch('bookings/occurrences/:id')
  updateOccurrence(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(updateOccurrenceSchema)) body: z.infer<typeof updateOccurrenceSchema>) {
    return this.bookings.updateOccurrence(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Post('bookings/occurrences/:id/cancel')
  @HttpCode(200)
  cancelOccurrence(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.cancelOccurrence(user.organizationId, id, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Patch('bookings/:id/series')
  updateSeries(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(updateSeriesSchema)) body: z.infer<typeof updateSeriesSchema>) {
    return this.bookings.updateSeries(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Post('bookings/:id/cancel-series')
  @HttpCode(200)
  cancelSeries(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(cancelSeriesSchema)) body: z.infer<typeof cancelSeriesSchema>) {
    return this.bookings.cancelSeries(user.organizationId, id, body.fromDate, webActor(user));
  }
}

// ───────────────────────── Contas ─────────────────────────

@Controller('bills')
export class BillsController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.billing.listBills(user.organizationId);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(billSchema)) body: z.infer<typeof billSchema>) {
    return this.billing.createBill(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(billSchema.partial())) body: Partial<z.infer<typeof billSchema>>) {
    return this.billing.updateBill(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.suspendBill(user.organizationId, id, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.reactivateBill(user.organizationId, id, webActor(user));
  }

  @Get('occurrences')
  occurrences(@CurrentUser() user: AuthUser, @Query(v(z.object({ competence }))) q: { competence: string }) {
    return this.billing.listOccurrences(user.organizationId, q.competence);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query(v(z.object({ competence }))) q: { competence: string }) {
    return this.billing.summary(user.organizationId, q.competence);
  }

  @Roles('owner', 'admin')
  @Post('occurrences/:id/payments')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(paymentSchema)) body: z.infer<typeof paymentSchema>) {
    return this.billing.registerPayment(user.organizationId, id, body, webActor(user));
  }
}

// ───────────────────────── Lembretes ─────────────────────────

@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: ReminderService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.reminders.list(user.organizationId);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(reminderSchema)) body: z.infer<typeof reminderSchema>) {
    return this.reminders.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reminders.deactivate(user.organizationId, id, webActor(user));
  }
}

// ───────────────────────── Visão geral ─────────────────────────

@Controller('overview')
export class OverviewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingService,
    private readonly billing: BillingService,
    private readonly projects: ProjectService,
  ) {}

  /** Números da tela inicial: agenda de hoje, contas a vencer em 7 dias e atrasadas, mês corrente. */
  @Get()
  async overview(@CurrentUser() user: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const now = new Date();
    const today = localDateOf(now, org.timezone);
    const day = localDayBoundsUtc(today, org.timezone);
    const [todayBookings, open, summary, projects] = await Promise.all([
      this.bookings.listOccurrences(org.id, day.start, day.end),
      this.billing.listOpen(org.id),
      this.billing.summary(org.id, competenceOf(now, org.timezone)),
      this.projects.list(org.id),
    ]);
    const active = projects.filter((p) => p.status === 'active' || p.status === 'closing');
    const limit = addDays(today, 7);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return {
      date: today,
      timezone: org.timezone,
      todayBookings,
      billsDueSoon: open.filter((o) => iso(o.dueDate) >= today && iso(o.dueDate) <= limit),
      billsOverdue: open.filter((o) => iso(o.dueDate) < today),
      monthSummary: summary,
      activeProjects: active.length,
      projectsToReview: active.reduce((n, p) => n + p.toReview, 0),
    };
  }
}

// ───────────────────────── Projetos ─────────────────────────

/**
 * Revisão e correção dos workspaces de projeto. Leitura para todos; tarefas para a equipe;
 * validação financeira e encerramento só para administração.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user.organizationId);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.detail(user.organizationId, id);
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(projectPatchSchema)) body: z.infer<typeof projectPatchSchema>) {
    return this.projects.update(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Post(':id/tasks')
  createTask(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(taskSchema)) body: z.infer<typeof taskSchema>) {
    return this.projects.createTask(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Patch(':id/tasks/:taskId')
  updateTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body(v(taskPatchSchema)) body: z.infer<typeof taskPatchSchema>,
  ) {
    return this.projects.updateTask(user.organizationId, id, taskId, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post(':id/expenses/:expenseId/review')
  @HttpCode(200)
  reviewExpense(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('expenseId') expenseId: string,
    @Body(v(expenseReviewSchema)) body: z.infer<typeof expenseReviewSchema>,
  ) {
    return this.projects.reviewExpense(user.organizationId, id, expenseId, body.action, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post(':id/events/:eventId/review')
  @HttpCode(204)
  async reviewEvent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body(v(eventReviewSchema)) body: z.infer<typeof eventReviewSchema>,
  ) {
    await this.projects.reviewEvent(user.organizationId, id, eventId, body.decision, webActor(user));
  }

  /** Encerrar pelo painel: a confirmação é o diálogo do próprio painel. */
  @Roles('owner', 'admin')
  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.close(user.organizationId, id, webActor(user));
  }
}
