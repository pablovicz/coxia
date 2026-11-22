import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { type Actor, DomainError, ResidentAccountService, ResidentBookingService, ResidentContractService, ResidentService } from '@coxia/domain';
import { randomUUID } from 'node:crypto';
import { localDateOf } from '@coxia/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AllowPendingPassword, type AuthResident, CurrentResident, ResidentRoute } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { sniffImage } from '../domain/controllers';
import { isoDate, isoDateTime } from '../domain/schemas';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const v = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);

const bookSchema = z.object({
  contractId: z.string().min(1),
  startAt: isoDateTime,
  endAt: isoDateTime,
  repeatWeekly: z.boolean().optional(),
  onConflict: z.enum(['fail', 'skip']).optional(),
  label: z.string().max(80).nullish(),
  notes: z.string().max(1000).nullish(),
});
const labelSchema = z.object({ label: z.string().max(80).nullish(), notes: z.string().max(1000).nullish() });
const emailSchema = z.object({ email: z.string().email().max(200), currentPassword: z.string().min(1).max(200) });
const PHOTO_MAX = 5 * 1024 * 1024;
const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const rangeSchema = z.object({ from: isoDateTime, to: isoDateTime });
const dayRangeSchema = z.object({ from: isoDate, to: isoDate });
const cancelSeriesSchema = z.object({ fromDate: isoDate });
const walkInSchema = z.object({ durationMinutes: z.number().int().min(30).max(24 * 60).optional() });

function residentActor(r: AuthResident): Actor {
  return { channel: 'resident', residentAccountId: r.accountId };
}

/**
 * Workspace do residente. Tudo é do próprio residente: o id vem do token, nunca da URL,
 * e cada consulta filtra por ele.
 */
@ResidentRoute()
@Controller('me')
export class ResidentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ResidentContractService,
    private readonly bookings: ResidentBookingService,
    private readonly storage: StorageService,
    private readonly residents: ResidentService,
    private readonly accounts: ResidentAccountService,
  ) {}

  @AllowPendingPassword()
  @Get()
  async me(@CurrentResident() r: AuthResident) {
    const resident = await this.prisma.resident.findUniqueOrThrow({
      where: { id: r.residentId },
      select: { id: true, name: true, email: true, photoUpdatedAt: true, organization: { select: { id: true, name: true, timezone: true } }, account: { select: { mustChangePassword: true, email: true } } },
    });
    const profile = { id: resident.id, name: resident.name, email: resident.email, loginEmail: resident.account?.email ?? resident.email, photoUpdatedAt: resident.photoUpdatedAt };
    if (resident.account?.mustChangePassword) {
      return { resident: profile, organization: resident.organization, contracts: [], mustChangePassword: true, features: { checkIn: this.bookings.checkInEnabled } };
    }
    const contracts = await this.contracts.list(r.organizationId, r.residentId);
    return {
      resident: profile,
      organization: resident.organization,
      contracts: contracts.map((c) => this.presentContract(c)),
      mustChangePassword: false,
      features: { checkIn: this.bookings.checkInEnabled },
    };
  }

  @Get('contracts/:id')
  async contract(@CurrentResident() r: AuthResident, @Param('id') id: string) {
    await this.bookings.ownContract(r.organizationId, r.residentId, id);
    const b = await this.contracts.balance(r.organizationId, id);
    return { contract: this.presentContract(b.contract), open: b.open, cycles: b.cycles };
  }

  @Get('contracts/:id/file')
  async contractFile(@CurrentResident() r: AuthResident, @Param('id') id: string, @Res() res: Response) {
    const c = await this.bookings.ownContract(r.organizationId, r.residentId, id);
    if (!c.contractKey) throw new DomainError('not_found', 'Contrato sem arquivo');
    const stream = await this.storage.get(c.contractKey);
    res.setHeader('content-type', c.contractContentType ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }

  @Get('contracts/:id/availability')
  availability(@CurrentResident() r: AuthResident, @Param('id') id: string, @Query(v(dayRangeSchema)) q: z.infer<typeof dayRangeSchema>) {
    return this.bookings.availability(r.organizationId, r.residentId, id, q.from, q.to);
  }

  @Get('bookings')
  list(@CurrentResident() r: AuthResident, @Query(v(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.bookings.list(r.organizationId, r.residentId, q.from, q.to);
  }

  @Get('bookings/occurrences/:id')
  occurrence(@CurrentResident() r: AuthResident, @Param('id') id: string) {
    return this.bookings.getOwn(r.organizationId, r.residentId, id);
  }

  @Post('bookings')
  book(@CurrentResident() r: AuthResident, @Body(v(bookSchema)) body: z.infer<typeof bookSchema>) {
    return this.bookings.book(r.organizationId, r.residentId, body, residentActor(r));
  }

  /** Nome e descrição internos da reserva (só o residente vê). Vale para a série inteira. */
  @Patch('bookings/:bookingId')
  label(@CurrentResident() r: AuthResident, @Param('bookingId') bookingId: string, @Body(v(labelSchema)) body: z.infer<typeof labelSchema>) {
    return this.bookings.updateLabel(r.organizationId, r.residentId, bookingId, body, residentActor(r));
  }

  @Post('bookings/occurrences/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentResident() r: AuthResident, @Param('id') id: string) {
    return this.bookings.cancelOccurrence(r.organizationId, r.residentId, id, residentActor(r));
  }

  @Post('bookings/:bookingId/cancel-series')
  @HttpCode(200)
  cancelSeries(@CurrentResident() r: AuthResident, @Param('bookingId') bookingId: string, @Body(v(cancelSeriesSchema)) body: z.infer<typeof cancelSeriesSchema>) {
    return this.bookings.cancelSeries(r.organizationId, r.residentId, bookingId, body.fromDate, residentActor(r));
  }

  /** Check-in pelo link do convite. */
  @Post('bookings/occurrences/:id/check-in')
  @HttpCode(200)
  checkIn(@CurrentResident() r: AuthResident, @Param('id') id: string) {
    return this.bookings.checkIn(r.organizationId, r.residentId, id, 'email_link', residentActor(r));
  }

  /** QR code da sala: o que dá para fazer agora. */
  @Get('rooms/:spaceId/check-in')
  async roomStatus(@CurrentResident() r: AuthResident, @Param('spaceId') spaceId: string) {
    const space = await this.prisma.space.findFirst({ where: { id: spaceId, organizationId: r.organizationId, active: true }, select: { id: true, name: true, color: true, icon: true } });
    if (!space) throw new DomainError('not_found', 'Sala não encontrada');
    return { space, ...(await this.bookings.roomStatus(r.organizationId, r.residentId, spaceId)) };
  }

  /** QR code: check-in da reserva atual ou, sem reserva, uso avulso (com a duração escolhida). */
  @Post('rooms/:spaceId/check-in')
  @HttpCode(200)
  async roomCheckIn(@CurrentResident() r: AuthResident, @Param('spaceId') spaceId: string, @Body(v(walkInSchema)) body: z.infer<typeof walkInSchema>) {
    const status = await this.bookings.roomStatus(r.organizationId, r.residentId, spaceId);
    if (status.state === 'checked_in') return status.occurrence;
    if (status.state === 'booking') return this.bookings.checkIn(r.organizationId, r.residentId, status.occurrence.id, 'room_qr', residentActor(r));
    if (!body.durationMinutes) throw new DomainError('validation', 'Escolha por quanto tempo vai usar a sala', { code: 'duration_required', status });
    return this.bookings.walkIn(r.organizationId, r.residentId, spaceId, body.durationMinutes, residentActor(r));
  }

  // ───────────── configurações ─────────────

  /** Foto do residente (a mesma que a equipe vê). Corpo bruto: JPG, PNG ou WebP, até 5 MB. */
  @Post('photo')
  async uploadPhoto(@CurrentResident() r: AuthResident, @Body() body: unknown, @Headers('content-type') contentType?: string) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new DomainError('validation', 'Envie a foto em JPG, PNG ou WebP', { code: 'invalid_file' });
    if (body.length > PHOTO_MAX) throw new DomainError('validation', 'A foto deve ter até 5 MB', { code: 'file_too_large' });
    const sniffed = sniffImage(body);
    if (!sniffed || (contentType && contentType.split(';')[0]!.trim() !== sniffed)) throw new DomainError('validation', 'Envie a foto em JPG, PNG ou WebP', { code: 'invalid_file' });
    const key = `${r.organizationId}/residents/${r.residentId}/photo-${randomUUID()}.${PHOTO_EXT[sniffed]}`;
    await this.storage.put(key, body, sniffed);
    try {
      const { previousKey } = await this.residents.setFile(r.organizationId, r.residentId, 'photo', { key, contentType: sniffed }, residentActor(r));
      if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
      return { ok: true };
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  @Delete('photo')
  async removePhoto(@CurrentResident() r: AuthResident) {
    const { previousKey } = await this.residents.setFile(r.organizationId, r.residentId, 'photo', null, residentActor(r));
    if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
    return { ok: true };
  }

  @Get('photo')
  async photo(@CurrentResident() r: AuthResident, @Res() res: Response) {
    const resident = await this.residents.get(r.organizationId, r.residentId);
    if (!resident.photoKey) throw new DomainError('not_found', 'Sem foto');
    const stream = await this.storage.get(resident.photoKey);
    res.setHeader('content-type', resident.photoContentType ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }

  /** Troca o e-mail de acesso (pede a senha atual). */
  @Post('email')
  @HttpCode(200)
  async email(@CurrentResident() r: AuthResident, @Body(v(emailSchema)) body: z.infer<typeof emailSchema>) {
    const acc = await this.accounts.changeEmail(r.accountId, body.currentPassword, body.email);
    return { email: acc.email };
  }

  /** Mensalidades e pagamentos (entradas ligadas ao residente): feitos e futuros. */
  @Get('payments')
  async payments(@CurrentResident() r: AuthResident) {
    const resident = await this.prisma.resident.findUniqueOrThrow({ where: { id: r.residentId }, select: { contactId: true, organization: { select: { timezone: true } } } });
    const today = localDateOf(new Date(), resident.organization.timezone);
    const rows = await this.prisma.income.findMany({
      where: { organizationId: r.organizationId, contactId: resident.contactId, status: { not: 'cancelled' } },
      select: { id: true, description: true, amountCents: true, receivedAmountCents: true, expectedOn: true, receivedOn: true, status: true, competence: true },
      orderBy: { expectedOn: 'desc' },
    });
    return rows.map((i) => {
      const expectedOn = i.expectedOn.toISOString().slice(0, 10);
      return {
        id: i.id,
        description: i.description,
        competence: i.competence,
        status: i.status,
        amountCents: i.status === 'received' ? (i.receivedAmountCents ?? i.amountCents) : i.amountCents,
        expectedOn,
        receivedOn: i.receivedOn ? i.receivedOn.toISOString().slice(0, 10) : null,
        overdue: i.status === 'expected' && expectedOn < today,
      };
    });
  }

  private presentContract(c: Awaited<ReturnType<ResidentContractService['get']>> & { balance?: unknown }) {
    return {
      id: c.id,
      space: c.space,
      monthlyMinutes: c.monthlyMinutes,
      monthlyAmountCents: c.monthlyAmountCents,
      paymentDueDay: c.paymentDueDay,
      cycleDay: c.cycleDay,
      bookingOpensDay: c.bookingOpensDay,
      startsOn: c.startsOn.toISOString().slice(0, 10),
      endsOn: c.endsOn ? c.endsOn.toISOString().slice(0, 10) : null,
      status: c.status,
      hasFile: !!c.contractKey,
      contractFileName: c.contractFileName,
      ...(c.balance ? { balance: c.balance } : {}),
    };
  }
}
