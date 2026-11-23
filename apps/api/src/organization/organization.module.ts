import { StaffPasswordService } from '@coxia/domain';
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { normalizeBrPhone } from '@coxia/shared';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { sniffImage } from '../domain/controllers';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** Avatar: foto JPG, PNG ou WebP, até 5 MB. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

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
  /** Opcional: sem senha inicial, a pessoa cria a sua pelo link do e-mail de boas-vindas. */
  password: z.string().min(8, 'A senha inicial precisa de pelo menos 8 caracteres').max(200).nullish(),
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
  user: { select: { id: true, name: true, email: true, phone: true, avatarUpdatedAt: true } },
} as const;

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === 'P2002';

@Controller()
export class OrganizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Boas-vindas (e-mail com link para criar a senha). */
  private get passwords() {
    return new StaffPasswordService(this.prisma, { hash: (p) => bcrypt.hash(p, 12), compare: (p, h) => bcrypt.compare(p, h) });
  }

  // ───────────── Avatar (cada pessoa cuida da própria foto) ─────────────

  /** Foto enviada como corpo bruto (image/jpeg, image/png ou image/webp), até 5 MB. Troca a anterior. */
  @Post('organization/me/avatar')
  async uploadAvatar(@CurrentUser() user: AuthUser, @Body() body: unknown, @Headers('content-type') contentType?: string) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new UnprocessableEntityException({ code: 'invalid_photo', message: 'Envie a foto em JPG, PNG ou WebP' });
    if (body.length > MAX_AVATAR_BYTES) throw new UnprocessableEntityException({ code: 'photo_too_large', message: 'A foto deve ter até 5 MB' });
    const sniffed = sniffImage(body);
    if (!sniffed || (contentType && contentType.split(';')[0]!.trim() !== sniffed)) {
      throw new UnprocessableEntityException({ code: 'invalid_photo', message: 'Envie a foto em JPG, PNG ou WebP' });
    }
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { avatarKey: true } });
    const key = `${user.organizationId}/avatars/${user.userId}/${randomUUID()}.${AVATAR_EXT[sniffed]}`;
    await this.storage.put(key, body, sniffed);
    const updated = await this.prisma.user.update({
      where: { id: user.userId },
      data: { avatarKey: key, avatarContentType: sniffed, avatarUpdatedAt: new Date() },
      select: { avatarUpdatedAt: true },
    });
    if (before.avatarKey) await this.storage.delete(before.avatarKey).catch(() => undefined);
    await this.record(user, 'user.avatar_updated', user.memberId, {});
    return { avatarUpdatedAt: updated.avatarUpdatedAt };
  }

  @Delete('organization/me/avatar')
  @HttpCode(200)
  async deleteAvatar(@CurrentUser() user: AuthUser) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { avatarKey: true } });
    await this.prisma.user.update({ where: { id: user.userId }, data: { avatarKey: null, avatarContentType: null, avatarUpdatedAt: null } });
    if (before.avatarKey) await this.storage.delete(before.avatarKey).catch(() => undefined);
    await this.record(user, 'user.avatar_removed', user.memberId, {});
    return { avatarUpdatedAt: null };
  }

  /** Foto de quem é da mesma organização (bucket privado: passa pela api). */
  @Get('organization/users/:userId/avatar')
  async avatar(@CurrentUser() user: AuthUser, @Param('userId') userId: string, @Res() res: Response) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId: user.organizationId, userId },
      select: { user: { select: { avatarKey: true, avatarContentType: true } } },
    });
    if (!member?.user.avatarKey) throw new NotFoundException('Sem foto');
    const stream = await this.storage.get(member.user.avatarKey);
    res.setHeader('content-type', member.user.avatarContentType ?? 'application/octet-stream');
    // A URL leva a versão (?v=): pode ficar em cache; trocar a foto muda a versão.
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  }

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
    // Todos da equipe (quem não tem WhatsApp vem com phone null: participa, mas não recebe aviso).
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, role: true, user: { select: { id: true, name: true, phone: true, avatarUpdatedAt: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((m) => ({ memberId: m.id, userId: m.user.id, name: m.user.name, phone: m.user.phone, role: m.role, avatarUpdatedAt: m.user.avatarUpdatedAt }));
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

  /**
   * Nova pessoa da equipe. Recebe o e-mail de boas-vindas com o link para criar a senha; a senha
   * inicial é opcional (se houver, a administração repassa). Só o responsável cria outro responsável.
   */
  @Roles('owner', 'admin')
  @Post('organization/team')
  async addMember(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(newMemberSchema)) body: z.infer<typeof newMemberSchema>) {
    if (body.role === 'owner' && user.role !== 'owner') throw new ForbiddenException('Só o responsável pode cadastrar outro responsável');
    const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : null;
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
      await this.passwords.sendWelcome(member.user.id, user.organizationId);
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
