import { Body, Controller, Delete, Get, Headers, Param, Post, Res } from '@nestjs/common';
import { DomainError, IncomeService } from '@coxia/domain';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { StorageService } from '../storage/storage.service';
import { sniffProof } from './controllers';
import { webActor } from './schemas';

const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Comprovante de uma entrada recebida (ex.: mensalidade do residente). Corpo bruto: PDF ou foto, até 10 MB. */
@Roles('owner', 'admin', 'staff')
@Controller('incomes')
export class IncomeProofController {
  constructor(
    private readonly incomes: IncomeService,
    private readonly storage: StorageService,
  ) {}

  @Roles('owner', 'admin')
  @Post(':id/proof')
  async upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown, @Headers('content-type') contentType?: string, @Headers('x-file-name') fileName?: string) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new DomainError('validation', 'Envie o comprovante em PDF ou foto', { code: 'invalid_file' });
    if (body.length > MAX_PROOF_BYTES) throw new DomainError('validation', 'O comprovante deve ter até 10 MB', { code: 'file_too_large' });
    const sniffed = sniffProof(body);
    if (!sniffed || (contentType && contentType.split(';')[0]!.trim() !== sniffed)) throw new DomainError('validation', 'Envie o comprovante em PDF ou foto', { code: 'invalid_file' });
    const key = `${user.organizationId}/incomes/${id}/proof-${randomUUID()}.${EXT[sniffed]}`;
    await this.storage.put(key, body, sniffed);
    try {
      const name = fileName ? decodeURIComponent(fileName).slice(0, 200) : null;
      const { previousKey } = await this.incomes.setProof(user.organizationId, id, { key, contentType: sniffed, fileName: name }, webActor(user));
      if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
      return { ok: true };
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  @Roles('owner', 'admin')
  @Delete(':id/proof')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { previousKey } = await this.incomes.setProof(user.organizationId, id, null, webActor(user));
    if (previousKey) await this.storage.delete(previousKey).catch(() => undefined);
    return { ok: true };
  }

  @Get(':id/proof')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const p = await this.incomes.proof(user.organizationId, id);
    const stream = await this.storage.get(p.key);
    res.setHeader('content-type', p.contentType);
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }
}
