import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { enqueueDelivery } from '@coxia/database';
import { type Actor, composeWorkspaceWelcome, DomainError, getOrganization, ProjectService } from '@coxia/domain';
import type { WhatsappProvider } from '@coxia/shared';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_PROVIDER } from './whatsapp.provider';

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  objective: z.string().max(2000).nullish(),
  estimatedBudgetCents: z.number().int().nonnegative().nullish(),
  groupCheckIns: z.boolean().optional(),
  /** false: só cria o projeto (o grupo fica para "Criar no WhatsApp"). */
  createGroup: z.boolean().optional(),
});

export type GroupResult =
  | { status: 'created'; groupName: string; invitationLink: string | null; added: number; notAdded: string[]; adminsWithoutPhone: string[] }
  | { status: 'unavailable'; reason: string };

const webActor = (user: AuthUser): Actor => ({ channel: 'web', userId: user.userId });

/**
 * Projetos criados pelo painel. O grupo do WhatsApp ("PROJETO - Nome") nasce com a Coxia e todas
 * as administradoras; se o WhatsApp estiver indisponível, o projeto fica criado e o grupo é feito
 * depois em "Criar no WhatsApp".
 */
@Controller('projects')
export class ProjectGroupsController {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsappProvider,
    private readonly projects: ProjectService,
    private readonly prisma: PrismaService,
  ) {}

  /** Para o formulário: prefixo do nome do grupo, se o WhatsApp está conectado e quem entra. */
  @Roles('owner', 'admin')
  @Get('new/group-info')
  async groupInfo(@CurrentUser() user: AuthUser) {
    const org = await getOrganization(this.prisma, user.organizationId);
    const instance = await this.prisma.whatsappInstance.findFirst({ where: { organizationId: user.organizationId }, orderBy: { createdAt: 'asc' } });
    const admins = await this.prisma.organizationMember.findMany({
      where: { organizationId: user.organizationId, role: { in: ['owner', 'admin'] } },
      select: { user: { select: { id: true, name: true, phone: true, avatarUpdatedAt: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return {
      prefix: org.projectGroupPrefix,
      whatsappConnected: !!instance?.connected,
      admins: admins.map((a) => ({ userId: a.user.id, name: a.user.name, hasPhone: !!a.user.phone, avatarUpdatedAt: a.user.avatarUpdatedAt })),
    };
  }

  @Roles('owner', 'admin')
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createProjectSchema)) body: z.infer<typeof createProjectSchema>) {
    const { project, groupName } = await this.projects.createFromWeb(user.organizationId, body, webActor(user));
    const group: GroupResult = body.createGroup === false ? { status: 'unavailable', reason: 'Grupo não pedido' } : await this.createGroup(user, project.id, project.title);
    return { project, groupName, group };
  }

  /** "Criar no WhatsApp": projeto sem grupo (o WhatsApp estava indisponível na criação). */
  @Roles('owner', 'admin')
  @Post(':id/whatsapp-group')
  async createGroupFor(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, organizationId: user.organizationId }, include: { channels: true } });
    if (!project) throw new DomainError('not_found', 'Projeto não encontrado');
    if (project.status === 'closed') throw new DomainError('validation', 'Projeto encerrado');
    if (project.channels.length) throw new DomainError('conflict', 'O projeto já tem grupo no WhatsApp', { code: 'project_has_group' });
    const group = await this.createGroup(user, project.id, project.title);
    if (group.status !== 'created') throw new DomainError('conflict', group.reason, { code: 'whatsapp_unavailable' });
    return group;
  }

  private async createGroup(user: AuthUser, projectId: string, title: string): Promise<GroupResult> {
    const org = await getOrganization(this.prisma, user.organizationId);
    const instance = await this.prisma.whatsappInstance.findFirst({ where: { organizationId: user.organizationId }, orderBy: { createdAt: 'asc' } });
    if (!instance) return { status: 'unavailable', reason: 'O WhatsApp da Coxia ainda não foi configurado' };
    if (!instance.connected) return { status: 'unavailable', reason: 'O WhatsApp da Coxia está desconectado' };
    const { phones, withoutPhone } = await this.projects.adminPhones(user.organizationId, instance.phone);
    if (!phones.length) return { status: 'unavailable', reason: 'Nenhuma administradora tem telefone cadastrado (Configurações → Equipe)' };
    const groupName = this.projects.groupNameFor(org.projectGroupPrefix, title);
    let created;
    try {
      created = await this.provider.createGroup(groupName, phones);
    } catch (err) {
      return { status: 'unavailable', reason: `Não foi possível criar o grupo no WhatsApp: ${(err as Error).message}` };
    }
    await this.projects.linkCreatedGroup(user.organizationId, projectId, { instanceId: instance.id, externalGroupId: created.id, name: groupName }, webActor(user));
    // Boas-vindas no grupo (aviso de privacidade e retenção), como na ativação pelo WhatsApp.
    await enqueueDelivery(this.prisma, {
      organizationId: user.organizationId,
      recipient: created.id,
      text: composeWorkspaceWelcome(title, org.retentionDays),
      idempotencyKey: `project_welcome:${projectId}`,
    });
    return {
      status: 'created',
      groupName,
      invitationLink: created.invitationLink,
      added: phones.length - created.notAdded.length,
      notAdded: created.notAdded,
      adminsWithoutPhone: withoutPhone,
    };
  }
}
