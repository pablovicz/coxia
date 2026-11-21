import { Controller, Get, Global, Header, HttpCode, Inject, Injectable, Logger, type MessageEvent, Module, type OnModuleDestroy, Post, Query, Sse, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { redisConnectionFromUrl } from '@coxia/config';
import { EVENTS_CHANNEL } from '@coxia/contracts';
import type { DomainEvent, DomainEventPublisher } from '@coxia/domain';
import { Redis } from 'ioredis';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { type AuthResident, type AuthUser, CurrentResident, CurrentUser, Public, ResidentRoute } from '../auth/decorators';
import { AuthModule } from '../auth/auth.module';
import { API_ENV, type ApiEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export const DOMAIN_EVENTS = Symbol('DOMAIN_EVENTS');

/** Publica no Redis: todas as réplicas da api (e o worker) entregam aos navegadores conectados. */
@Injectable()
export class RedisEventBus implements DomainEventPublisher, OnModuleDestroy {
  private readonly logger = new Logger(RedisEventBus.name);
  private readonly pub: Redis;
  private readonly sub: Redis;
  readonly stream = new Subject<DomainEvent>();

  constructor(@Inject(API_ENV) env: ApiEnv) {
    const opts = { ...redisConnectionFromUrl(env.REDIS_URL), lazyConnect: false, maxRetriesPerRequest: 3 };
    this.pub = new Redis(opts);
    this.sub = new Redis(opts);
    for (const c of [this.pub, this.sub]) c.on('error', (err) => this.logger.warn({ err: err.message }, 'redis (eventos) com erro'));
    void this.sub.subscribe(EVENTS_CHANNEL).catch((err: Error) => this.logger.warn({ err: err.message }, 'falha ao assinar eventos'));
    this.sub.on('message', (_channel, raw) => {
      try {
        this.stream.next(JSON.parse(raw) as DomainEvent);
      } catch {
        // mensagem malformada: ignora
      }
    });
  }

  publish(event: DomainEvent): void {
    this.pub.publish(EVENTS_CHANNEL, JSON.stringify(event)).catch((err: Error) => this.logger.warn({ err: err.message, type: event.type }, 'falha ao publicar evento'));
  }

  async onModuleDestroy() {
    this.stream.complete();
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}

interface TicketPayload {
  kind: 'sse';
  org: string;
  /** Quem vai ouvir: a equipe (tudo da organização) ou um residente (só o que é dele). */
  who: 'staff' | 'resident';
  res?: string;
}

const TICKET_TTL = '60s';
const HEARTBEAT_MS = 25_000;

@Controller()
export class EventsController {
  constructor(
    private readonly bus: RedisEventBus,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Ticket de 60 s para abrir o EventSource (que não manda o header Authorization). */
  @Post('events/ticket')
  @HttpCode(200)
  async staffTicket(@CurrentUser() user: AuthUser) {
    const ticket = await this.jwt.signAsync({ kind: 'sse', org: user.organizationId, who: 'staff' } satisfies TicketPayload, { expiresIn: TICKET_TTL });
    return { ticket };
  }

  @ResidentRoute()
  @Post('me/events/ticket')
  @HttpCode(200)
  async residentTicket(@CurrentResident() r: AuthResident) {
    const ticket = await this.jwt.signAsync({ kind: 'sse', org: r.organizationId, who: 'resident', res: r.residentId } satisfies TicketPayload, { expiresIn: TICKET_TTL });
    return { ticket };
  }

  /**
   * Fluxo de eventos (SSE). Só ids e o tipo do que mudou; a tela recarrega o que precisar
   * pela api normal (com as permissões de sempre).
   */
  @Public()
  @Sse('events')
  @Header('x-accel-buffering', 'no')
  @Header('cache-control', 'no-cache, no-transform')
  async events(@Query('ticket') ticket?: string): Promise<Observable<MessageEvent>> {
    let t: TicketPayload;
    try {
      t = await this.jwt.verifyAsync<TicketPayload>(ticket ?? '');
    } catch {
      throw new UnauthorizedException();
    }
    if (t.kind !== 'sse') throw new UnauthorizedException();

    let accept: (e: DomainEvent) => DomainEvent | null;
    if (t.who === 'staff') {
      accept = (e) => (e.organizationId === t.org ? e : null);
    } else {
      const residentId = t.res!;
      // Salas e contratos do residente; recarrega quando um contrato dele muda.
      let spaces = new Set<string>();
      let contracts = new Set<string>();
      const load = async () => {
        const rows = await this.prisma.residentContract.findMany({ where: { residentId, organizationId: t.org }, select: { id: true, spaceId: true } });
        spaces = new Set(rows.map((r) => r.spaceId));
        contracts = new Set(rows.map((r) => r.id));
      };
      await load();
      accept = (e) => {
        if (e.organizationId !== t.org) return null;
        if (e.residentId === residentId) {
          if (e.type === 'contract.changed') void load();
          return e;
        }
        if (e.contractId && contracts.has(e.contractId)) return e;
        // Reserva de outra pessoa numa sala minha: só "a disponibilidade mudou", sem de quem.
        if (e.type === 'booking.changed' && e.spaceId && spaces.has(e.spaceId)) return { organizationId: e.organizationId, type: 'booking.changed', spaceId: e.spaceId };
        return null;
      };
    }

    const events = this.bus.stream.pipe(
      map((e) => accept(e)),
      filter((e): e is DomainEvent => e !== null),
      map((e): MessageEvent => ({ type: 'change', data: { type: e.type, contractId: e.contractId ?? null, spaceId: e.spaceId ?? null, residentId: t.who === 'staff' ? (e.residentId ?? null) : null } })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return merge(new Observable<MessageEvent>((s) => s.next({ type: 'ready', data: '' })), events, heartbeat);
  }
}

@Global()
@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [RedisEventBus, { provide: DOMAIN_EVENTS, useExisting: RedisEventBus }],
  exports: [RedisEventBus, DOMAIN_EVENTS],
})
export class EventsModule {}
