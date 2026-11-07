import { BullModule } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { QUEUES } from '@coxia/contracts';
import type { WhatsappProvider } from '@coxia/shared';
import { timingSafeEqual } from 'node:crypto';
import { Public, Roles } from '../auth/decorators';
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

@Controller('whatsapp')
export class WhatsappAdminController {
  constructor(@Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsappProvider) {}

  /** Estado da sessão do WhatsApp, para o painel de conexão. */
  @Roles('owner', 'admin')
  @Get('connection')
  async connection() {
    const status = await this.provider.checkConnection();
    return { provider: this.provider.name, connected: status.connected, smartphoneConnected: status.smartphoneConnected, error: status.error };
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
