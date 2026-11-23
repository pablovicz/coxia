import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  AppointmentService,
  BillingService,
  BookingService,
  CalendarService,
  FinanceService,
  ResidentService,
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
import { createHash, randomUUID } from 'node:crypto';
import { addDays, localDateOf, localDayBoundsUtc } from '@coxia/shared';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  appointmentSchema,
  availabilitySchema,
  calendarQuery,
  billSchema,
  blockSchema,
  cancelSeriesSchema,
  competence,
  contactCreateSchema,
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
  residentSchema,
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

/** Comprovante: foto (JPG, PNG, WebP) ou PDF, até 10 MB. */
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const PROOF_EXT: Record<string, string> = { ...PHOTO_EXT, 'application/pdf': 'pdf' };
const PROOF_TYPE: Record<string, string> = Object.fromEntries(Object.entries(PROOF_EXT).map(([type, ext]) => [ext, type]));

/** Documentos de projeto: PDF, foto ou Office (docx/xlsx/pptx), até 20 MB. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const OFFICE_TYPES: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** Tipo do documento pelos bytes: PDF e fotos pela assinatura; Office é um zip ("PK") com o tipo declarado. */
export function sniffDocument(buf: Buffer, declared: string | undefined): string | null {
  const proof = sniffProof(buf);
  if (proof) return proof;
  const type = declared?.split(';')[0]!.trim();
  if (type && OFFICE_TYPES[type] && buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return type;
  return null;
}

/** Tipo do comprovante pelos primeiros bytes (foto ou PDF). */
export function sniffProof(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return sniffImage(buf);
}

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
    return this.contacts.list(user.organizationId, { q: q.q, groupId: q.groupId, kind: q.kind, typeId: q.typeId, take: q.limit, skip: q.offset });
  }

  @Get('groups')
  groups(@CurrentUser() user: AuthUser) {
    return this.contacts.listGroups(user.organizationId);
  }

  /** Cadastro manual (nome e WhatsApp); número já cadastrado → 409 com o id do contato. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(contactCreateSchema)) body: z.infer<typeof contactCreateSchema>) {
    return this.contacts.create(user.organizationId, body, webActor(user));
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
  constructor(
    private readonly billing: BillingService,
    private readonly storage: StorageService,
  ) {}

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

  /** Exclui a conta e o que é dela; os comprovantes enviados pelo painel saem do bucket. */
  @Roles('owner', 'admin')
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { storageKeys } = await this.billing.deleteBill(user.organizationId, id, webActor(user));
    await Promise.all(storageKeys.map((k) => this.storage.delete(k).catch(() => undefined)));
    return { ok: true };
  }

  @Roles('owner', 'admin')
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.reactivateBill(user.organizationId, id, webActor(user));
  }

  /** Em aberto que vencem nos próximos dias (padrão 10), mais as atrasadas. */
  @Get('upcoming')
  upcoming(@CurrentUser() user: AuthUser, @Query(v(z.object({ days: z.coerce.number().int().min(1).max(60).default(10) }))) q: { days: number }) {
    return this.billing.upcoming(user.organizationId, q.days);
  }

  @Get(':id/details')
  async details(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const d = await this.billing.details(user.organizationId, id);
    // Telefones são dado pessoal: perfil leitura não vê quem recebe os avisos.
    return user.role === 'viewer' ? { ...d, bill: { ...d.bill, recipientPhones: [], responsiblePhone: null } } : d;
  }

  @Get('occurrences')
  occurrences(@CurrentUser() user: AuthUser, @Query(v(z.object({ competence }))) q: { competence: string }) {
    return this.billing.listOccurrences(user.organizationId, q.competence);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query(v(z.object({ competence }))) q: { competence: string }) {
    return this.billing.summary(user.organizationId, q.competence);
  }

  /**
   * Pagamento com comprovante (corpo bruto: foto ou PDF). Conta em aberto: registra o pagamento
   * (sem valor, quita o restante — com a multa, se atrasada) e a conta fica paga.
   * Conta já paga: só anexa o comprovante. O mesmo arquivo não vale para duas contas.
   */
  @Roles('owner', 'admin')
  @Post('occurrences/:id/payments/with-proof')
  async payWithProof(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Query(v(z.object({ amountCents: z.coerce.number().int().positive().optional(), paidOn: isoDate.optional() }))) q: { amountCents?: number; paidOn?: string },
    @Headers('content-type') contentType?: string,
  ) {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new DomainError('validation', 'Envie o comprovante em foto (JPG, PNG, WebP) ou PDF', { code: 'invalid_proof' });
    }
    if (body.length > MAX_PROOF_BYTES) throw new DomainError('validation', 'O comprovante deve ter até 10 MB', { code: 'proof_too_large' });
    const sniffed = sniffProof(body);
    if (!sniffed || (contentType && contentType.split(';')[0]!.trim() !== sniffed)) {
      throw new DomainError('validation', 'Envie o comprovante em foto (JPG, PNG, WebP) ou PDF', { code: 'invalid_proof' });
    }
    const sha256 = createHash('sha256').update(body).digest('hex');
    const storageKey = `${user.organizationId}/proofs/${id}/${randomUUID()}.${PROOF_EXT[sniffed]}`;
    await this.storage.put(storageKey, body, sniffed);
    try {
      const occ = await this.billing.getOccurrence(user.organizationId, id);
      if (occ.status === 'paid') {
        await this.billing.attachProof(user.organizationId, id, { sha256, storageKey }, webActor(user));
        return { occurrence: await this.billing.getOccurrence(user.organizationId, id), attachedOnly: true };
      }
      return await this.billing.registerPayment(user.organizationId, id, { amountCents: q.amountCents ?? null, paidOn: q.paidOn ?? null, proof: { sha256, storageKey } }, webActor(user));
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /** O comprovante passa pela api (bucket privado). */
  @Get('payments/:paymentId/proof')
  async proof(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string, @Res() res: Response) {
    const payment = await this.billing.getPayment(user.organizationId, paymentId);
    if (!payment.storageKey) throw new DomainError('not_found', 'Este pagamento não tem comprovante');
    const ext = payment.storageKey.split('.').pop() ?? '';
    const stream = await this.storage.get(payment.storageKey);
    // Comprovantes vindos do WhatsApp podem não ter extensão: o navegador decide pelo conteúdo.
    res.setHeader('content-type', PROOF_TYPE[ext] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }

  @Roles('owner', 'admin')
  @Post('occurrences/:id/payments')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(paymentSchema)) body: z.infer<typeof paymentSchema>) {
    return this.billing.registerPayment(user.organizationId, id, body, webActor(user));
  }

  /** Remove o vencimento de um mês (cobrança errada). Só sem pagamento registrado. */
  @Roles('owner', 'admin')
  @Post('occurrences/:id/remove')
  @HttpCode(200)
  removeOccurrence(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.removeOccurrence(user.organizationId, id, webActor(user));
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

// ───────────────────────── Residentes ─────────────────────────

/** Arquivos do residente: foto (imagem) ou contrato (PDF ou foto), até 10 MB. */
const RESIDENT_FILE_MAX = 10 * 1024 * 1024;

/** Dados pessoais (telefone, e-mail, contrato): perfil leitura não vê residentes. */
@Roles('owner', 'admin', 'staff')
@Controller('residents')
export class ResidentsController {
  constructor(
    private readonly residents: ResidentService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.residents.list(user.organizationId);
  }

  @Get(':id')
  details(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.residents.details(user.organizationId, id);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(residentSchema)) body: z.infer<typeof residentSchema>) {
    return this.residents.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(residentSchema.partial())) body: Partial<z.infer<typeof residentSchema>>) {
    return this.residents.update(user.organizationId, id, body, webActor(user));
  }

  /** Foto (corpo bruto: JPG, PNG ou WebP) ou contrato (PDF ou foto). Troca o arquivo anterior. */
  @Roles('owner', 'admin')
  @Post(':id/photo')
  uploadPhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown, @Headers('content-type') contentType?: string) {
    return this.upload(user, id, 'photo', body, contentType);
  }

  @Roles('owner', 'admin')
  @Post(':id/contract')
  uploadContract(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown, @Headers('content-type') contentType?: string, @Headers('x-file-name') fileName?: string) {
    return this.upload(user, id, 'contract', body, contentType, fileName);
  }

  @Roles('owner', 'admin')
  @Delete(':id/photo')
  removePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.removeFile(user, id, 'photo');
  }

  @Roles('owner', 'admin')
  @Delete(':id/contract')
  removeContract(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.removeFile(user, id, 'contract');
  }

  @Get(':id/photo')
  photo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    return this.file(user, id, 'photo', res);
  }

  @Get(':id/contract')
  contract(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    return this.file(user, id, 'contract', res);
  }

  private async upload(user: AuthUser, id: string, kind: 'photo' | 'contract', body: unknown, contentType?: string, fileName?: string) {
    const what = kind === 'photo' ? 'a foto em JPG, PNG ou WebP' : 'o contrato em PDF ou foto';
    if (!Buffer.isBuffer(body) || body.length === 0) throw new DomainError('validation', `Envie ${what}`, { code: 'invalid_file' });
    if (body.length > RESIDENT_FILE_MAX) throw new DomainError('validation', 'O arquivo deve ter até 10 MB', { code: 'file_too_large' });
    const sniffed = kind === 'photo' ? sniffImage(body) : sniffProof(body);
    if (!sniffed || (contentType && contentType.split(';')[0]!.trim() !== sniffed)) throw new DomainError('validation', `Envie ${what}`, { code: 'invalid_file' });
    await this.residents.get(user.organizationId, id);
    const key = `${user.organizationId}/residents/${id}/${kind}-${randomUUID()}.${PROOF_EXT[sniffed]}`;
    await this.storage.put(key, body, sniffed);
    try {
      const name = fileName ? decodeURIComponent(fileName).slice(0, 200) : null;
      const { previousKey } = await this.residents.setFile(user.organizationId, id, kind, { key, contentType: sniffed, fileName: name }, webActor(user));
      if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
      return this.residents.get(user.organizationId, id);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  private async removeFile(user: AuthUser, id: string, kind: 'photo' | 'contract') {
    const { previousKey } = await this.residents.setFile(user.organizationId, id, kind, null, webActor(user));
    if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
    return this.residents.get(user.organizationId, id);
  }

  private async file(user: AuthUser, id: string, kind: 'photo' | 'contract', res: Response) {
    const r = await this.residents.get(user.organizationId, id);
    const key = kind === 'photo' ? r.photoKey : r.contractKey;
    if (!key) throw new DomainError('not_found', kind === 'photo' ? 'Sem foto' : 'Sem contrato');
    const stream = await this.storage.get(key);
    res.setHeader('content-type', (kind === 'photo' ? r.photoContentType : r.contractContentType) ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }
}

// ───────────────────────── Compromissos e calendário da equipe ─────────────────────────

type AppointmentRow = Awaited<ReturnType<AppointmentService['get']>>;

/** Perfil leitura vê quem vai, sem telefones. */
function hideAppointmentPhones(a: AppointmentRow): AppointmentRow {
  return {
    ...a,
    participants: a.participants.map((p) => ({
      ...p,
      phone: null,
      member: p.member ? { ...p.member, user: { ...p.member.user, phone: null } } : null,
      contact: p.contact ? { ...p.contact, phone: '' } : null,
    })),
  };
}

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentService) {}

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const a = await this.appointments.get(user.organizationId, id);
    return user.role === 'viewer' ? hideAppointmentPhones(a) : a;
  }

  @Roles('owner', 'admin', 'staff')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(v(appointmentSchema)) body: z.infer<typeof appointmentSchema>) {
    return this.appointments.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(appointmentSchema)) body: z.infer<typeof appointmentSchema>) {
    return this.appointments.update(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.cancel(user.organizationId, id, webActor(user));
  }
}

@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  /** Visão unificada: entradas e saídas mês a mês no ano, com o mês atual marcado. */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query(v(z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }))) q: { year?: number }) {
    return this.finance.year(user.organizationId, q.year ?? new Date().getFullYear());
  }
}

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** Compromissos, lembretes (recorrentes expandidos) e contas do período. */
  @Get()
  async range(@CurrentUser() user: AuthUser, @Query(v(calendarQuery)) q: z.infer<typeof calendarQuery>) {
    const data = await this.calendar.range(user.organizationId, q.from, q.to);
    if (user.role !== 'viewer') return data;
    return {
      appointments: data.appointments.map(hideAppointmentPhones),
      reminders: data.reminders.map((r) => ({ ...r, person: { ...r.person, phone: null }, recipientPhones: [] })),
      bills: data.bills,
    };
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
    private readonly storage: StorageService,
  ) {}

  // ───────────── documentos: documento, croqui, comprovante ─────────────

  @Get(':id/documents')
  documents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.listDocuments(user.organizationId, id);
  }

  /** Arquivo como corpo bruto; tipo em ?kind= e nome no cabeçalho x-file-name. */
  @Roles('owner', 'admin', 'staff')
  @Post(':id/documents')
  async addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Query(v(z.object({ kind: z.enum(['document', 'sketch', 'receipt']).default('document') }))) q: { kind: 'document' | 'sketch' | 'receipt' },
    @Headers('content-type') contentType?: string,
    @Headers('x-file-name') fileName?: string,
  ) {
    const what = 'Envie PDF, foto (JPG, PNG, WebP) ou arquivo do Word, Excel ou PowerPoint';
    if (!Buffer.isBuffer(body) || body.length === 0) throw new DomainError('validation', what, { code: 'invalid_file' });
    if (body.length > MAX_DOCUMENT_BYTES) throw new DomainError('validation', 'O arquivo deve ter até 20 MB', { code: 'file_too_large' });
    const type = sniffDocument(body, contentType);
    if (!type || (contentType && contentType.split(';')[0]!.trim() !== type)) throw new DomainError('validation', what, { code: 'invalid_file' });
    const ext = PROOF_EXT[type] ?? OFFICE_TYPES[type]!;
    const key = `${user.organizationId}/projects/${id}/documents/${randomUUID()}.${ext}`;
    await this.storage.put(key, body, type);
    try {
      const name = fileName ? decodeURIComponent(fileName) : `documento.${ext}`;
      return await this.projects.addDocument(user.organizationId, id, { kind: q.kind, fileName: name, contentType: type, sizeBytes: body.length, storageKey: key }, webActor(user));
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  /** O arquivo passa pela api (bucket privado); o nome original vai no download. */
  @Get(':id/documents/:documentId/file')
  async documentFile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('documentId') documentId: string, @Res() res: Response) {
    const d = await this.projects.getDocument(user.organizationId, id, documentId);
    const stream = await this.storage.get(d.storageKey);
    res.setHeader('content-type', d.contentType);
    res.setHeader('content-length', String(d.sizeBytes));
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.fileName)}`);
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }

  @Roles('owner', 'admin')
  @Delete(':id/documents/:documentId')
  async removeDocument(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('documentId') documentId: string) {
    const { storageKey } = await this.projects.removeDocument(user.organizationId, id, documentId, webActor(user));
    await this.storage.delete(storageKey).catch(() => undefined);
    return { ok: true };
  }

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

  /** Exclui o projeto e o que é dele; os arquivos dos documentos saem do bucket. */
  @Roles('owner', 'admin')
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { storageKeys } = await this.projects.deleteProject(user.organizationId, id, webActor(user));
    await Promise.all(storageKeys.map((k) => this.storage.delete(k).catch(() => undefined)));
    return { ok: true };
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
