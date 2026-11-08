import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { normalizeBrPhone } from '@coxia/shared';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const role = z.enum(['owner', 'admin', 'staff', 'viewer']);
const phoneField = z
  .string()
  .max(30)
  .nullish()
  .transform((s, ctx) => {
    if (!s?.trim()) return null;
    const p = normalizeBrPhone(s);
    if (!p || p.length < 12 || p.length > 15) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido: use DDD e número, ex.: 11 98765-4321' });
      return z.NEVER;
    }
    return p;
  });

const newMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: phoneField,
  role: role.default('admin'),
  password: z.string().min(8, 'A senha inicial precisa de pelo menos 8 caracteres').max(200),
  canManageProjects: z.boolean().optional(),
  receivesMorningBriefing: z.boolean().optional(),
});

const memberPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneField.optional(),
  role: role.optional(),
  canManageProjects: z.boolean().optional(),
  receivesMorningBriefing: z.boolean().optional(),
});

const memberSelect = {
  id: true,
  role: true,
  canManageProjects: true,
  receivesMorningBriefing: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
} as const;

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === 'P2002';

@Controller()
export class OrganizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('organization')
  organization(@CurrentUser() user: AuthUser) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { id: true, name: true, slug: true, timezone: true, morningBriefingTime: true, projectGroupPrefix: true },
    });
  }

  /** Equipe com WhatsApp: destinatários de lembretes. */
  @Roles('owner', 'admin', 'staff')
  @Get('organization/members')
  async members(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId: user.organizationId, user: { phone: { not: null } } },
      select: { role: true, user: { select: { id: true, name: true, phone: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((m) => ({ userId: m.user.id, name: m.user.name, phone: m.user.phone!, role: m.role }));
  }

  // ───────────── Equipe (quem entra no painel e é reconhecido no WhatsApp) ─────────────

  @Roles('owner', 'admin')
  @Get('organization/team')
  team(@CurrentUser() user: AuthUser) {
    return this.prisma.organizationMember.findMany({
      where: { organizationId: user.organizationId },
      select: memberSelect,
      orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    });
  }

  /** Nova pessoa da equipe com senha inicial (a administração repassa). Só o responsável cria outro responsável. */
  @Roles('owner', 'admin')
  @Post('organization/team')
  async addMember(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(newMemberSchema)) body: z.infer<typeof newMemberSchema>) {
    if (body.role === 'owner' && user.role !== 'owner') throw new ForbiddenException('Só o responsável pode cadastrar outro responsável');
    const passwordHash = await bcrypt.hash(body.password, 12);
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { name: body.name, email: body.email, phone: body.phone, passwordHash } });
        return tx.organizationMember.create({
          data: {
            organizationId: user.organizationId,
            userId: created.id,
            role: body.role,
            canManageProjects: body.canManageProjects ?? (body.role === 'owner' || body.role === 'admin'),
            receivesMorningBriefing: body.receivesMorningBriefing ?? false,
          },
          select: memberSelect,
        });
      });
      await this.record(user, 'member.create', member.id, { after: { name: body.name, email: body.email, phone: body.phone, role: body.role } });
      return member;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Já existe alguém com esse e-mail ou telefone');
      throw err;
    }
  }

  /**
   * Edita uma pessoa da equipe. Cada um muda o próprio nome e telefone; papel e permissões,
   * só a administração. Não deixa a casa sem responsável.
   */
  @Patch('organization/team/:memberId')
  async updateMember(
    @CurrentUser() user: AuthUser,
    @Param('memberId') memberId: string,
    @Body(new ZodValidationPipe(memberPatchSchema)) body: z.infer<typeof memberPatchSchema>,
  ) {
    const member = await this.prisma.organizationMember.findFirst({ where: { id: memberId, organizationId: user.organizationId }, include: { user: true } });
    if (!member) throw new NotFoundException('Pessoa não encontrada');
    const self = member.id === user.memberId;
    const manager = user.role === 'owner' || user.role === 'admin';
    const touchesAccess = body.role !== undefined || body.canManageProjects !== undefined || body.receivesMorningBriefing !== undefined;
    if (!self && !manager) throw new ForbiddenException('Sem permissão para editar outra pessoa');
    if (touchesAccess && !manager) throw new ForbiddenException('Só a administração muda papel e permissões');
    if ((body.role === 'owner' || member.role === 'owner') && body.role !== undefined && body.role !== member.role && user.role !== 'owner') {
      throw new ForbiddenException('Só o responsável muda o papel de responsável');
    }
    if (member.role === 'owner' && body.role && body.role !== 'owner') {
      const owners = await this.prisma.organizationMember.count({ where: { organizationId: user.organizationId, role: 'owner' } });
      if (owners <= 1) throw new UnprocessableEntityException('A casa precisa de pelo menos um responsável');
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (body.name !== undefined || body.phone !== undefined) {
          await tx.user.update({
            where: { id: member.userId },
            data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.phone !== undefined ? { phone: body.phone } : {}) },
          });
        }
        return tx.organizationMember.update({
          where: { id: member.id },
          data: {
            ...(body.role !== undefined ? { role: body.role } : {}),
            ...(body.canManageProjects !== undefined ? { canManageProjects: body.canManageProjects } : {}),
            ...(body.receivesMorningBriefing !== undefined ? { receivesMorningBriefing: body.receivesMorningBriefing } : {}),
          },
          select: memberSelect,
        });
      });
      await this.record(user, 'member.update', member.id, {
        before: { name: member.user.name, phone: member.user.phone, role: member.role },
        after: body,
      });
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Esse telefone já está cadastrado para outra pessoa');
      throw err;
    }
  }

  private record(user: AuthUser, action: string, entityId: string, data: { before?: unknown; after?: unknown }) {
    return this.audit.record({
      organizationId: user.organizationId,
      actorChannel: 'web',
      actorUserId: user.userId,
      action,
      entityType: 'organization_member',
      entityId,
      ...data,
    });
  }
}

@Module({ controllers: [OrganizationController] })
export class OrganizationModule {}
