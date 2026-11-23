import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { MemberRole } from '@coxia/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_PENDING_PASSWORD, type AuthResident, type AuthUser, IS_PUBLIC, RESIDENT_ROUTE, ROLES } from './decorators';

interface StaffPayload {
  sub: string;
  org: string;
  mid: string;
  role: MemberRole;
  kind?: undefined;
  /** Emitido em (segundos), preenchido pelo JWT. */
  iat?: number;
}

/** Token do residente (workspace). */
export interface ResidentPayload {
  sub: string;
  org: string;
  res: string;
  kind: 'resident';
  /** Emitido em (segundos), preenchido pelo JWT. */
  iat?: number;
}

/** Ticket de curta duração para abrir o SSE (EventSource não manda Authorization). Nunca vale em rota HTTP. */
interface TicketPayload {
  kind: 'sse';
}

type JwtPayload = StaffPayload | ResidentPayload | TicketPayload;

type Req = { headers: Record<string, string | undefined>; user?: AuthUser; resident?: AuthResident };

/**
 * Guard global: toda rota exige Bearer JWT, exceto as marcadas com @Public().
 * - Token da equipe: só em rotas sem @ResidentRoute().
 * - Token do residente: só em rotas com @ResidentRoute().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const residentRoute = !!this.reflector.getAllAndOverride<boolean>(RESIDENT_ROUTE, targets);

    const req = ctx.switchToHttp().getRequest<Req>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.kind === 'sse') throw new UnauthorizedException();

    if (payload.kind === 'resident') {
      if (!residentRoute) throw new ForbiddenException();
      const allowPending = !!this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets);
      req.resident = await this.loadResident(payload, allowPending);
      return true;
    }
    if (residentRoute) throw new ForbiddenException();
    // O papel vem do banco, não do token: remover alguém ou mudar o papel vale na hora,
    // sem esperar o JWT expirar.
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: payload.mid },
      select: { role: true, userId: true, organizationId: true, user: { select: { sessionsValidFrom: true } } },
    });
    if (!member || member.userId !== payload.sub || member.organizationId !== payload.org) throw new UnauthorizedException();
    // Senha redefinida depois que este token foi emitido: precisa entrar de novo.
    const validFrom = member.user.sessionsValidFrom;
    if (validFrom && (payload.iat ?? 0) < Math.floor(validFrom.getTime() / 1000)) throw new UnauthorizedException();
    req.user = { userId: payload.sub, organizationId: payload.org, memberId: payload.mid, role: member.role };
    return true;
  }

  /** Acesso desativado (ou residente desabilitado) vale na hora, como o papel da equipe. */
  async loadResident(payload: ResidentPayload, allowPending = false): Promise<AuthResident> {
    const account = await this.prisma.residentAccount.findUnique({
      where: { id: payload.sub },
      select: { status: true, residentId: true, organizationId: true, mustChangePassword: true, sessionsValidFrom: true, resident: { select: { status: true } } },
    });
    if (!account || account.status !== 'active' || account.resident.status !== 'active' || account.residentId !== payload.res || account.organizationId !== payload.org) {
      throw new UnauthorizedException();
    }
    // Senha trocada/redefinida depois que este token foi emitido: precisa entrar de novo.
    if (account.sessionsValidFrom && (payload.iat ?? 0) < Math.floor(account.sessionsValidFrom.getTime() / 1000)) throw new UnauthorizedException();
    if (account.mustChangePassword && !allowPending) {
      throw new ForbiddenException({ statusCode: 403, code: 'forbidden', message: 'Troque a senha provisória para continuar', details: { code: 'password_change_required' } });
    }
    return { accountId: payload.sub, residentId: account.residentId, organizationId: account.organizationId };
  }
}

/** RBAC: aplica @Roles(...) quando presente. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
