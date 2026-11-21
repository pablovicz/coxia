import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { MemberRole } from '@coxia/contracts';

export const IS_PUBLIC = 'coxia:isPublic';
export const ROLES = 'coxia:roles';
export const RESIDENT_ROUTE = 'coxia:residentRoute';

/** Rota sem autenticação JWT (health, webhooks com segredo próprio, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restringe a rota aos papéis informados. */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES, roles);

/**
 * Rota do workspace do residente (residente.casakaju.com). Só tokens de residente passam;
 * tokens da equipe são recusados. Toda rota sem esta marca recusa residentes (negado por padrão).
 */
export const ResidentRoute = () => SetMetadata(RESIDENT_ROUTE, true);

export interface AuthUser {
  userId: string;
  organizationId: string;
  memberId: string;
  role: MemberRole;
}

export interface AuthResident {
  accountId: string;
  residentId: string;
  organizationId: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});

export const CurrentResident = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthResident => {
  return ctx.switchToHttp().getRequest<{ resident: AuthResident }>().resident;
});
