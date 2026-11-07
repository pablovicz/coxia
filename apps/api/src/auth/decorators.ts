import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { MemberRole } from '@coxia/contracts';

export const IS_PUBLIC = 'coxia:isPublic';
export const ROLES = 'coxia:roles';

/** Rota sem autenticação JWT (health, webhooks com segredo próprio, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restringe a rota aos papéis informados. */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  userId: string;
  organizationId: string;
  memberId: string;
  role: MemberRole;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
