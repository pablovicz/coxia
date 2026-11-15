import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { QuoteRequestService, SpaceService } from '@coxia/domain';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_ENV, type ApiEnv } from '../config/env';
import { StorageService } from '../storage/storage.service';
import { webActor } from './schemas';

const v = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);

/**
 * Limite de envios do formulário público, em memória (uma réplica da api, como no login):
 * 5 pedidos por IP em 10 min e 60 no total em 10 min (proteção contra robôs).
 */
export class SubmitThrottle {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 10 * 60_000,
    private readonly perIp = 5,
    private readonly total = 60,
  ) {}

  hit(ip: string, now = Date.now()) {
    for (const [key, limit] of [[`i:${ip}`, this.perIp], ['all', this.total]] as const) {
      const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
      if (list.length >= limit) {
        throw new HttpException({ statusCode: 429, message: 'Muitos envios. Tente de novo em alguns minutos ou chame no WhatsApp.' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      list.push(now);
      this.hits.set(key, list);
    }
    if (this.hits.size > 20_000) this.hits.clear();
  }
}

const publicQuoteSchema = z.object({
  name: z.string().max(200),
  email: z.string().max(200),
  phone: z.string().max(40),
  segment: z.string().max(40),
  services: z.array(z.string().max(40)).max(10),
  description: z.string().max(5000),
  neededBy: z.string().max(10).nullish(),
  /** Pedido feito na página de uma sala do site. */
  spaceSlug: z.string().max(80).nullish(),
  /** Campo escondido no site: gente não preenche, robô sim. */
  website: z.string().max(500).optional(),
});

/** Formulário "Solicite um orçamento" do site casakaju.com (sem login). */
@Public()
@Controller('public')
export class PublicQuoteController {
  private readonly throttle = new SubmitThrottle();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly quotes: QuoteRequestService,
  ) {}

  @Post('quote-requests')
  @HttpCode(201)
  async submit(@Body(v(publicQuoteSchema)) body: z.infer<typeof publicQuoteSchema>, @Req() req: { ip?: string }) {
    // Robô: responde como se tivesse dado certo, sem gravar nem avisar ninguém.
    if (body.website) return { ok: true };
    this.throttle.hit(req.ip ?? 'unknown');
    const organizationId = await this.quotes.siteOrganizationId(this.env.SITE_ORGANIZATION_SLUG);
    const { website: _honeypot, ...input } = body;
    await this.quotes.submit(organizationId, input);
    return { ok: true };
  }
}

/**
 * Salas no site público: só as ativas com "Mostrar no site", sem preço, inquilino nem situação.
 * O site (Next) busca a lista e o detalhe no servidor e regera as páginas de tempos em tempos.
 */
@Public()
@Controller('public/spaces')
export class PublicSpacesController {
  private organizationId: string | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly quotes: QuoteRequestService,
    private readonly spaces: SpaceService,
    private readonly storage: StorageService,
  ) {}

  private async org() {
    this.organizationId ??= await this.quotes.siteOrganizationId(this.env.SITE_ORGANIZATION_SLUG);
    return this.organizationId;
  }

  @Get()
  async list() {
    return this.spaces.listPublic(await this.org());
  }

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    return this.spaces.getPublic(await this.org(), slug);
  }

  /** Foto da sala (o id nunca muda de arquivo: cache longo). */
  @Get(':slug/photos/:photoId')
  async photo(@Param('slug') slug: string, @Param('photoId') photoId: string, @Res() res: Response) {
    const photo = await this.spaces.getPublicPhoto(await this.org(), slug, photoId);
    const stream = await this.storage.get(photo.storageKey);
    res.setHeader('content-type', photo.contentType);
    res.setHeader('content-length', String(photo.sizeBytes));
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    stream.pipe(res);
  }
}

const statusSchema = z.enum(['new', 'contacted', 'approved', 'archived']);

/** Pedidos de orçamento do site, para a equipe acompanhar (dado pessoal: perfil leitura não vê). */
@Roles('owner', 'admin', 'staff')
@Controller('quote-requests')
export class QuoteRequestsController {
  constructor(private readonly quotes: QuoteRequestService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(v(z.object({ status: statusSchema.optional() }))) q: { status?: z.infer<typeof statusSchema> }) {
    return this.quotes.list(user.organizationId, q.status);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotes.get(user.organizationId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(v(z.object({ status: statusSchema.optional(), notes: z.string().max(4000).nullish() }))) body: { status?: z.infer<typeof statusSchema>; notes?: string | null },
  ) {
    return this.quotes.update(user.organizationId, id, body, webActor(user));
  }
}
