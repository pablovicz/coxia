import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { DomainError, ResidentAccountService, ResidentBookingService, ResidentContractService } from '@coxia/domain';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StorageService } from '../storage/storage.service';
import { sniffProof } from './controllers';
import { isoDate, webActor } from './schemas';

const v = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);

const day = z.number().int().min(1).max(31);
export const contractSchema = z.object({
  spaceId: z.string().min(1),
  monthlyMinutes: z.number().int().positive().multipleOf(30),
  monthlyAmountCents: z.number().int().positive().nullish(),
  paymentDueDay: day.nullish(),
  cycleDay: day,
  bookingOpensDay: day,
  startsOn: isoDate,
  endsOn: isoDate.nullish(),
  notes: z.string().max(2000).nullish(),
});
const endSchema = z.object({ endsOn: isoDate.nullish() });
const provisionalSchema = z.object({ password: z.string().min(8).max(200) });
const adjustSchema = z.object({
  minutes: z.number().int().multipleOf(30).refine((m) => m !== 0, 'Ajuste diferente de zero'),
  note: z.string().trim().min(1).max(300),
  cycle: z.string().regex(/^\d{4}-\d{2}$/).nullish(),
});

const FILE_MAX = 10 * 1024 * 1024;
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Contratos de horas dos residentes. Leitura: equipe; escrita: owner/admin. */
@Roles('owner', 'admin', 'staff')
@Controller()
export class ContractsController {
  constructor(
    private readonly contracts: ResidentContractService,
    private readonly residentBookings: ResidentBookingService,
    private readonly accounts: ResidentAccountService,
    private readonly storage: StorageService,
  ) {}

  @Get('residents/:id/contracts')
  list(@CurrentUser() user: AuthUser, @Param('id') residentId: string) {
    return this.contracts.list(user.organizationId, residentId);
  }

  @Roles('owner', 'admin')
  @Post('residents/:id/contracts')
  create(@CurrentUser() user: AuthUser, @Param('id') residentId: string, @Body(v(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.contracts.create(user.organizationId, residentId, body, webActor(user));
  }

  @Get('contracts/:id')
  balance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contracts.balance(user.organizationId, id);
  }

  @Roles('owner', 'admin')
  @Patch('contracts/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(contractSchema.partial())) body: Partial<z.infer<typeof contractSchema>>) {
    return this.contracts.update(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post('contracts/:id/end')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(endSchema)) body: z.infer<typeof endSchema>) {
    return this.contracts.end(user.organizationId, id, body.endsOn ?? null, webActor(user));
  }

  /** Aumenta ou diminui o saldo do ciclo (atual ou o próximo já aberto). */
  @Roles('owner', 'admin')
  @Post('contracts/:id/adjustments')
  adjust(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(v(adjustSchema)) body: z.infer<typeof adjustSchema>) {
    return this.contracts.adjust(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin')
  @Post('contracts/:id/file')
  async upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown, @Headers('content-type') contentType?: string, @Headers('x-file-name') fileName?: string) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new DomainError('validation', 'Envie o contrato em PDF ou foto', { code: 'invalid_file' });
    if (body.length > FILE_MAX) throw new DomainError('validation', 'O arquivo deve ter até 10 MB', { code: 'file_too_large' });
    const sniffed = sniffProof(body);
    if (!sniffed || (contentType && contentType.split(';')[0]!.trim() !== sniffed)) throw new DomainError('validation', 'Envie o contrato em PDF ou foto', { code: 'invalid_file' });
    const contract = await this.contracts.get(user.organizationId, id);
    const key = `${user.organizationId}/residents/${contract.residentId}/contracts/${id}-${randomUUID()}.${EXT[sniffed]}`;
    await this.storage.put(key, body, sniffed);
    try {
      const name = fileName ? decodeURIComponent(fileName).slice(0, 200) : null;
      const { previousKey } = await this.contracts.setFile(user.organizationId, id, { key, contentType: sniffed, fileName: name }, webActor(user));
      if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
      return this.contracts.get(user.organizationId, id);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  @Roles('owner', 'admin')
  @Delete('contracts/:id/file')
  async removeFile(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { previousKey } = await this.contracts.setFile(user.organizationId, id, null, webActor(user));
    if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
    return this.contracts.get(user.organizationId, id);
  }

  @Get('contracts/:id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const c = await this.contracts.get(user.organizationId, id);
    if (!c.contractKey) throw new DomainError('not_found', 'Contrato sem arquivo');
    const stream = await this.storage.get(c.contractKey);
    res.setHeader('content-type', c.contractContentType ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }

  // ───────────── acesso ao workspace ─────────────

  @Get('residents/:id/access')
  access(@CurrentUser() user: AuthUser, @Param('id') residentId: string) {
    return this.accounts.status(user.organizationId, residentId);
  }

  /** Envia (ou reenvia) o convite por e-mail para definir a senha. */
  @Roles('owner', 'admin')
  @Post('residents/:id/access/invite')
  @HttpCode(200)
  invite(@CurrentUser() user: AuthUser, @Param('id') residentId: string) {
    return this.accounts.invite(user.organizationId, residentId, webActor(user));
  }

  /** Senha provisória: a equipe passa ao residente, que troca no primeiro acesso. */
  @Roles('owner', 'admin')
  @Post('residents/:id/access/password')
  @HttpCode(200)
  provisional(@CurrentUser() user: AuthUser, @Param('id') residentId: string, @Body(v(provisionalSchema)) body: z.infer<typeof provisionalSchema>) {
    return this.accounts.setProvisionalPassword(user.organizationId, residentId, body.password, webActor(user));
  }

  @Roles('owner', 'admin')
  @Delete('residents/:id/access')
  disable(@CurrentUser() user: AuthUser, @Param('id') residentId: string) {
    return this.accounts.disable(user.organizationId, residentId, webActor(user));
  }

  // ───────────── check-in pela equipe ─────────────

  @Post('bookings/occurrences/:id/check-in')
  @HttpCode(200)
  checkIn(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.residentBookings.checkIn(user.organizationId, null, id, 'staff', webActor(user));
  }
}
