import { BullModule } from '@nestjs/bullmq';
import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QUEUES } from '@coxia/contracts';
import { type ConnectCode, type WhatsappProvider, WhatsappProviderError } from '@coxia/shared';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { API_ENV, type ApiEnv } from '../config/env';
import { WhatsappIngestionService } from './ingestion.service';
import { createWhatsappProvider, WHATSAPP_PROVIDER } from './whatsapp.provider';

export function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Controller('webhooks')
export class WhatsappWebhookController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly ingestion: WhatsappIngestionService,
  ) {}

  /**
   * Callback da Z-API. A Z-API não assina payloads, então a URL carrega um segredo longo.
   * Segredo errado → 404 (não revela que a rota existe). Sempre responde rápido.
   */
  @Public()
  @Post('zapi/:secret')
  @HttpCode(200)
  async zapi(@Param('secret') secret: string, @Body() body: unknown, @Req() req: { id?: string }) {
    if (!secretMatches(secret, this.env.ZAPI_WEBHOOK_SECRET)) throw new NotFoundException();
    return this.ingestion.ingest(body, req.id ? String(req.id) : null);
  }
}

const phoneCodeSchema = z.object({
  phone: z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .pipe(z.string().min(10, 'Informe o número com DDI e DDD').max(15)),
});

@Controller('whatsapp')
export class WhatsappAdminController {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsappProvider,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Estado da sessão do WhatsApp, para o painel de conexão. */
  @Roles('owner', 'admin')
  @Get('connection')
  async connection() {
    const status = await this.provider.checkConnection();
    return { provider: this.provider.name, connected: status.connected, smartphoneConnected: status.smartphoneConnected, error: status.error };
  }

  /**
   * QR code para reconectar o número. Quem lê assume a sessão do WhatsApp da casa:
   * só administração, sem cache e com registro na auditoria (sem guardar a imagem).
   */
  @Roles('owner', 'admin')
  @Get('qr-code')
  @Header('cache-control', 'no-store')
  async qrCode(@CurrentUser() user: AuthUser): Promise<ConnectCode> {
    const res = await this.connectCall(() => this.provider.getQrCode());
    if (res.kind === 'qr') await this.record(user, 'whatsapp.qr_code_requested');
    return res;
  }

  /** Código de pareamento: alternativa ao QR, digitado no celular em "Conectar com número de telefone". */
  @Roles('owner', 'admin')
  @Post('phone-code')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async phoneCode(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(phoneCodeSchema)) body: { phone: string }): Promise<ConnectCode> {
    const res = await this.connectCall(() => this.provider.getPhoneCode(body.phone));
    if (res.kind === 'code') await this.record(user, 'whatsapp.phone_code_requested', { phone: body.phone });
    return res;
  }

  /**
   * Desconecta o número da Coxia. A instância fica marcada como desconectada na hora:
   * o outbox pausa (avisos esperam) e a tela de operação passa a mostrar o QR code.
   */
  @Roles('owner', 'admin')
  @Post('disconnect')
  @HttpCode(200)
  async disconnect(@CurrentUser() user: AuthUser) {
    try {
      await this.provider.disconnect();
    } catch {
      throw new BadGatewayException('Não foi possível desconectar pela Z-API agora. Tente de novo em instantes.');
    }
    const now = new Date();
    await this.prisma.whatsappInstance.updateMany({
      where: { organizationId: user.organizationId },
      data: { connected: false, lastCheckedAt: now, lastError: 'desconectado pelo painel' },
    });
    await this.record(user, 'whatsapp.disconnected_by_user');
    return { connected: false };
  }

  private async connectCall(fn: () => Promise<ConnectCode>): Promise<ConnectCode> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof WhatsappProviderError && err.status !== null && err.status < 500 && err.status !== 429) {
        throw new UnprocessableEntityException('A Z-API recusou o pedido. Confira o número e tente de novo.');
      }
      throw new BadGatewayException('Não foi possível falar com a Z-API agora. Tente de novo em instantes.');
    }
  }

  private record(user: AuthUser, action: string, after?: unknown) {
    return this.audit.record({
      organizationId: user.organizationId,
      actorChannel: 'web',
      actorUserId: user.userId,
      action,
      entityType: 'whatsapp_instance',
      entityId: user.organizationId,
      after,
    });
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.inbound })],
  controllers: [WhatsappWebhookController, WhatsappAdminController],
  providers: [
    WhatsappIngestionService,
    { provide: WHATSAPP_PROVIDER, inject: [API_ENV], useFactory: (env: ApiEnv) => createWhatsappProvider(env) },
  ],
  exports: [WHATSAPP_PROVIDER],
})
export class WhatsappModule {}
