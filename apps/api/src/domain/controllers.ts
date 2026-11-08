import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  BillingService,
  BookingService,
  competenceOf,
  ContactService,
  ExpenseCategoryService,
  IncomeService,
  ProjectService,
  ReminderService,
  DomainError,
  SpaceService,
} from '@coxia/domain';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { addDays, localDateOf, localDayBoundsUtc } from '@coxia/shared';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  availabilitySchema,
  billSchema,
  blockSchema,
  cancelSeriesSchema,
  competence,
  contactPatchSchema,
  contactsQuery,
  createBookingSchema,
  createSpaceSchema,
  eventReviewSchema,
  expenseCategorySchema,
  expenseReviewSchema,
  incomeSchema,
  isoDate,
  paymentSchema,
  projectPatchSchema,
  rangeQuery,
  receiveIncomeSchema,
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

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Confere o tipo pelos primeiros bytes: o content-type do cliente não basta. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spaces: SpaceService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('includeInactive') includeInactive?: string) {
    return this.spaces.list(user.organizationId, includeInactive === 'true');
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(createSpaceSchema)) body: z.infer<typeof createSpaceSchema>) {
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

  /** Foto enviada como corpo bruto (image/jpeg, image/png ou image/webp), até 5 MB. */
  @Roles('owner', 'admin')
  @Post(':id/photos')
  async addPhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown, @Headers('content-type') contentType?: string) {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new DomainError('validation', 'Envie a foto em JPG, PNG ou WebP', { code: 'invalid_photo' });
    }
    if (body.length > MAX_PHOTO_BYTES) throw new DomainError('validation', 'A foto deve ter até 5 MB', { code: 'photo_too_large' });
    const sniffed = sniffImage(body);
    if (!sniffed || (contentType && contentType.split(';')[0]!.trim() !== sniffed)) {
      throw new DomainError('validation', 'Envie a foto em JPG, PNG ou WebP', { code: 'invalid_photo' });
    }
    await this.spaces.get(user.organizationId, id);
    const storageKey = `${user.organizationId}/spaces/${id}/${randomUUID()}.${PHOTO_EXT[sniffed]}`;
    await this.storage.put(storageKey, body, sniffed);
    try {
      return await this.spaces.addPhoto(user.organizationId, id, { storageKey, contentType: sniffed, sizeBytes: body.length }, webActor(user));
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /** A foto passa pela api (bucket privado): qualquer pessoa logada da organização vê. */
  @Get(':id/photos/:photoId')
  async photo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string, @Res() res: Response) {
    const photo = await this.spaces.getPhoto(user.organizationId, id, photoId);
    const stream = await this.storage.get(photo.storageKey);
    res.setHeader('content-type', photo.contentType);
    res.setHeader('content-length', String(photo.sizeBytes));
    // O id da foto muda quando ela é trocada: pode ficar em cache no navegador.
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }

  @Roles('owner', 'admin')
  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photoId') photoId: string) {
    const photo = await this.spaces.removePhoto(user.organizationId, id, photoId, webActor(user));
    // Objeto órfão no bucket não quebra nada; o registro já saiu.
    await this.storage.delete(photo.storageKey).catch(() => undefined);
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

// ───────────────────────── Contatos ─────────────────────────

/**
 * Pessoas dos grupos do WhatsApp. Telefones são dado pessoal: perfil leitura não vê.
 * A equipe (staff) busca e corrige nomes; os contatos em si nascem do WhatsApp.
 */
@Roles('owner', 'admin', 'staff')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(v(contactsQuery)) q: z.infer<typeof contactsQuery>) {
    return this.contacts.list(user.organizationId, { q: q.q, groupId: q.groupId, kind: q.kind, take: q.limit, skip: q.offset });
  }

  @Get('groups')
  groups(@CurrentUser() user: AuthUser) {
    return this.contacts.listGroups(user.organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contacts.get(user.organizationId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(contactPatchSchema)) body: z.infer<typeof contactPatchSchema>) {
    return this.contacts.update(user.organizationId, id, body, webActor(user));
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
    return this.bookings.cancelSeries(user.organizationId, id, body.fromDate, webActor(user), { wholeGroup: body.wholeGroup });
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

// ───────────────────────── Categorias de gasto ─────────────────────────

@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('includeArchived') includeArchived?: string) {
    return this.categories.list(user.organizationId, includeArchived === 'true');
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(expenseCategorySchema)) body: z.infer<typeof expenseCategorySchema>) {
    return this.categories.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(v(expenseCategorySchema.partial().extend({ active: z.boolean().optional() }))) body: Partial<z.infer<typeof expenseCategorySchema>> & { active?: boolean },
  ) {
    return this.categories.update(user.organizationId, id, body, webActor(user));
  }
}

// ───────────────────────── Entradas ─────────────────────────

/** Entradas de dinheiro (projeto, aluguel de sala, outras). Leitura como as contas; escrita só administração. */
@Controller('incomes')
export class IncomesController {
  constructor(private readonly incomes: IncomeService) {}

  /** O mês pedido; o aluguel mensal das salas é garantido antes (idempotente). */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('competence', v(competence)) c: string) {
    await this.incomes.generateRentals(user.organizationId);
    return this.incomes.list(user.organizationId, c);
  }

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser, @Query('competence', v(competence)) c: string) {
    await this.incomes.generateRentals(user.organizationId);
    return this.incomes.summary(user.organizationId, c);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(incomeSchema)) body: z.infer<typeof incomeSchema>) {
    return this.incomes.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(incomeSchema.partial())) body: Partial<z.infer<typeof incomeSchema>>) {
    return this.incomes.update(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post(':id/receive')
  @HttpCode(200)
  receive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(receiveIncomeSchema)) body: z.infer<typeof receiveIncomeSchema>) {
    return this.incomes.receive(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.incomes.cancel(user.organizationId, id, webActor(user));
  }
}

// ───────────────────────── Lembretes ─────────────────────────

/** Telefones são dado pessoal: perfil leitura vê os lembretes, mas sem números. */
function hidePhones<R extends { personPhone: string | null; recipientPhones: string[]; contact: { phone: string } | null }>(r: R): R {
  return { ...r, personPhone: null, recipientPhones: [], contact: r.contact ? { ...r.contact, phone: '' } : null };
}

@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: ReminderService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.reminders.list(user.organizationId);
    return user.role === 'viewer' ? rows.map(hidePhones) : rows;
  }

  /** Avisos que as contas já disparam sozinhas (véspera, dia e atraso), vistos como lembretes. */
  @Get('automatic')
  async automatic(@CurrentUser() user: AuthUser) {
    const rows = await this.reminders.automaticFromBills(user.organizationId);
    return user.role === 'viewer' ? rows.map((r) => ({ ...r, recipients: r.recipients.map((x) => ({ ...x, phone: '' })) })) : rows;
  }

  // A equipe também agenda os próprios lembretes ("ligar para a Carla às 14h").
  @Roles('owner', 'admin', 'staff')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(reminderSchema)) body: z.infer<typeof reminderSchema>) {
    return this.reminders.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
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
  constructor(
    private readonly projects: ProjectService,
    private readonly incomes: IncomeService,
  ) {}

  /** Entradas previstas e recebidas do projeto (patrocínio, parcelas, bilheteria). */
  @Get(':id/incomes')
  async incomesOf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.projects.detail(user.organizationId, id);
    return this.incomes.listForProject(user.organizationId, id);
  }

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
