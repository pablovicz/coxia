import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUniqueViolation, Prisma } from '@coxia/database';
import { IS_PUBLIC } from '../auth/decorators';
import { stableHash } from '@coxia/shared';
import { from, type Observable, of, switchMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

const TTL_MS = 24 * 60 * 60 * 1000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Idempotência para mutações vindas do painel: com o header `Idempotency-Key`,
 * repetir a mesma requisição devolve a resposta original em vez de executar de novo.
 * - mesma chave + corpo diferente → 422
 * - mesma chave ainda em execução → 409
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    // Rotas públicas (login, webhooks) ficam de fora: login devolveria tokens guardados no banco,
    // e webhooks já deduplicam pela chave da mensagem.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return next.handle();
    }
    const req = ctx.switchToHttp().getRequest<{
      method: string;
      headers: Record<string, string | undefined>;
      body: unknown;
      route?: { path?: string };
      user?: { userId: string };
    }>();
    const key = req.headers['idempotency-key'];
    if (!key || !MUTATING.has(req.method)) return next.handle();
    if (key.length > 200) throw new UnprocessableEntityException('Idempotency-Key muito longa');

    const scope = `http:${req.user?.userId ?? 'anon'}:${req.method}:${req.route?.path ?? ''}`;
    const requestHash = stableHash(req.body ?? null);

    try {
      await this.prisma.idempotencyRecord.create({
        data: { scope, key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.prisma.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope, key } } });
      if (existing.requestHash !== requestHash) {
        throw new UnprocessableEntityException('Idempotency-Key já usada com outro conteúdo');
      }
      if (existing.response === null) throw new ConflictException('Requisição ainda em processamento');
      return of(existing.response);
    }

    return next.handle().pipe(
      switchMap((response) =>
        from(
          this.prisma.idempotencyRecord
            .update({
              where: { scope_key: { scope, key } },
              data: { response: (response ?? null) as Prisma.InputJsonValue },
            })
            .then(() => response),
        ),
      ),
    );
  }
}
