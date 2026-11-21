import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { type Actor, DomainError, ResidentBookingService, ResidentContractService } from '@coxia/domain';
import { localDateOf } from '@coxia/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AllowPendingPassword, type AuthResident, CurrentResident, ResidentRoute } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
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
});
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
  ) {}

  @AllowPendingPassword()
  @Get()
  async me(@CurrentResident() r: AuthResident) {
    const resident = await this.prisma.resident.findUniqueOrThrow({
      where: { id: r.residentId },
      select: { id: true, name: true, email: true, photoUpdatedAt: true, organization: { select: { id: true, name: true, timezone: true } }, account: { select: { mustChangePassword: true } } },
    });
    if (resident.account?.mustChangePassword) {
      return { resident: { id: resident.id, name: resident.name, email: resident.email }, organization: resident.organization, contracts: [], mustChangePassword: true };
    }
    const contracts = await this.contracts.list(r.organizationId, r.residentId);
    return {
      resident: { id: resident.id, name: resident.name, email: resident.email },
      organization: resident.organization,
      contracts: contracts.map((c) => this.presentContract(c)),
      mustChangePassword: false,
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
