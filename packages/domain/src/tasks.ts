import type { Prisma, TaskComplexity, TaskStatus } from '@coxia/database';
import { type IsoDate, localDateOf, localDayBoundsUtc } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError, fromIsoDate, getOrganization, toIsoDate } from './common';

export const TASK_TITLE_MAX = 500;
export const TASK_DESCRIPTION_MAX = 4000;
export const TASK_NOTE_MAX = 4000;
export const TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'done'];
export const TASK_COMPLEXITIES: TaskComplexity[] = ['low', 'medium', 'high'];

export interface TeamTaskFilters {
  status?: TaskStatus;
  /** Id do projeto, ou "none" para as tarefas sem projeto. */
  projectId?: string;
  /** Pessoa da equipe responsável (OrganizationMember.id). */
  assigneeId?: string;
  complexity?: TaskComplexity;
  /** Pessoa da equipe (OrganizationMember.id) que realizou. */
  completedBy?: string;
  /** Período: data de realização nas concluídas; data de criação nas demais. */
  from?: IsoDate;
  to?: IsoDate;
  /** Busca no título e na descrição. */
  q?: string;
}

export interface TeamTaskInput {
  title: string;
  description?: string | null;
  complexity: TaskComplexity;
  /** Ao criar/editar só pendente ou em andamento; concluir é pelo encerramento. */
  status?: Exclude<TaskStatus, 'done'>;
  projectId?: string | null;
  /** Responsáveis: pessoas da equipe (OrganizationMember.id). */
  assigneeIds?: string[];
}

export interface TeamTaskCompletionInput {
  /** Data de realização (padrão: hoje no fuso da casa). */
  completedOn?: IsoDate | null;
  /** Quem da equipe realizou (OrganizationMember.id). */
  memberIds?: string[];
}

const ROW_INCLUDE = {
  project: { select: { id: true, title: true } },
  assignees: { include: { member: { select: { id: true, user: { select: { id: true, name: true, avatarUpdatedAt: true } } } } } },
  completers: { include: { member: { select: { id: true, user: { select: { id: true, name: true, avatarUpdatedAt: true } } } } } },
  _count: { select: { notes: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof ROW_INCLUDE }>;

function toRow(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    complexity: t.complexity,
    status: t.status,
    project: t.project,
    completedOn: t.completedOn ? toIsoDate(t.completedOn) : null,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    assignees: t.assignees
      .map((a) => ({ memberId: a.member.id, userId: a.member.user.id, name: a.member.user.name, avatarUpdatedAt: a.member.user.avatarUpdatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    completers: t.completers
      .map((c) => ({ memberId: c.member.id, userId: c.member.user.id, name: c.member.user.name, avatarUpdatedAt: c.member.user.avatarUpdatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    notesCount: t._count.notes,
  };
}

/** Normaliza e valida os campos de texto da tarefa. */
export function normalizeTaskText(input: { title: string; description?: string | null }) {
  const title = input.title?.trim().replace(/\s+/g, ' ');
  if (!title) throw new DomainError('validation', 'Informe o título da tarefa');
  if (title.length > TASK_TITLE_MAX) throw new DomainError('validation', `Título com até ${TASK_TITLE_MAX} caracteres`);
  const description = input.description?.trim() || null;
  if (description && description.length > TASK_DESCRIPTION_MAX) throw new DomainError('validation', `Descrição com até ${TASK_DESCRIPTION_MAX} caracteres`);
  return { title, description };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tarefas da equipe (módulo "Tarefas"). Independem das tarefas que a IA extrai do grupo do WhatsApp
 * (ProjectTask): têm complexidade, responsáveis da equipe, observações e encerramento com quem realizou.
 */
export class TaskService {
  constructor(private readonly db: Db) {}

  async list(organizationId: string, filters: TeamTaskFilters = {}) {
    const org = await getOrganization(this.db, organizationId);
    const base = this.where(organizationId, org.timezone, filters);
    const [tasks, grouped] = await Promise.all([
      this.db.task.findMany({
        where: { ...base, ...(filters.status ? { status: filters.status } : {}) },
        include: ROW_INCLUDE,
        orderBy: [{ createdAt: 'asc' }],
      }),
      // Contagens por status com os demais filtros: os números das abas.
      this.db.task.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const g of grouped) counts[g.status] = g._count._all;
    return { tasks: tasks.map(toRow), counts };
  }

  async get(organizationId: string, id: string) {
    const t = await this.db.task.findFirst({
      where: { id, organizationId },
      include: {
        ...ROW_INCLUDE,
        notes: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, user: { select: { id: true, name: true, avatarUpdatedAt: true } } } } },
        },
      },
    });
    if (!t) throw new DomainError('not_found', 'Tarefa não encontrada');
    return {
      ...toRow(t),
      notes: t.notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt,
        author: n.author ? { memberId: n.author.id, userId: n.author.user.id, name: n.author.user.name, avatarUpdatedAt: n.author.user.avatarUpdatedAt } : null,
      })),
    };
  }

  async create(organizationId: string, input: TeamTaskInput, actor: Actor) {
    const { title, description } = normalizeTaskText(input);
    const projectId = await this.validProject(organizationId, input.projectId);
    const assigneeIds = await this.validMembers(organizationId, input.assigneeIds);
    const id = await this.db.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: {
          organizationId,
          title,
          description,
          complexity: input.complexity,
          status: input.status ?? 'pending',
          projectId,
          createdByUserId: actor.userId ?? null,
          assignees: { create: assigneeIds.map((memberId) => ({ memberId })) },
        },
      });
      await audit(tx, organizationId, actor, 'task.create', 'task', t.id, { after: { title, complexity: t.complexity, status: t.status, projectId, assigneeIds } });
      return t.id;
    });
    return this.get(organizationId, id);
  }

  async update(organizationId: string, id: string, input: TeamTaskInput, actor: Actor) {
    const before = await this.get(organizationId, id);
    const { title, description } = normalizeTaskText(input);
    const projectId = await this.validProject(organizationId, input.projectId);
    const assigneeIds = await this.validMembers(organizationId, input.assigneeIds);
    // Concluída continua concluída ao editar; para reabrir há "Reabrir".
    const status = before.status === 'done' ? 'done' : (input.status ?? before.status);
    await this.db.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: { title, description, complexity: input.complexity, status, projectId } });
      await tx.taskAssignee.deleteMany({ where: { taskId: id } });
      if (assigneeIds.length) await tx.taskAssignee.createMany({ data: assigneeIds.map((memberId) => ({ taskId: id, memberId })) });
      await audit(tx, organizationId, actor, 'task.update', 'task', id, {
        before: { title: before.title, description: before.description, complexity: before.complexity, status: before.status, projectId: before.project?.id ?? null, assigneeIds: before.assignees.map((a) => a.memberId) },
        after: { title, description, complexity: input.complexity, status, projectId, assigneeIds },
      });
    });
    return this.get(organizationId, id);
  }

  /** Encerra a tarefa: data de realização (padrão hoje) e quem da equipe realizou. */
  async complete(organizationId: string, id: string, input: TeamTaskCompletionInput, actor: Actor) {
    const before = await this.get(organizationId, id);
    const org = await getOrganization(this.db, organizationId);
    const completedOn = input.completedOn || localDateOf(new Date(), org.timezone);
    if (!ISO_DATE.test(completedOn) || Number.isNaN(fromIsoDate(completedOn).getTime())) throw new DomainError('validation', 'Data de realização inválida');
    const memberIds = await this.validMembers(organizationId, input.memberIds);
    await this.db.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: { status: 'done', completedOn: fromIsoDate(completedOn), completedAt: before.completedAt ?? new Date() } });
      await tx.taskCompleter.deleteMany({ where: { taskId: id } });
      if (memberIds.length) await tx.taskCompleter.createMany({ data: memberIds.map((memberId) => ({ taskId: id, memberId })) });
      await audit(tx, organizationId, actor, 'task.complete', 'task', id, { before: { status: before.status }, after: { status: 'done', completedOn, memberIds } });
    });
    return this.get(organizationId, id);
  }

  /** Volta a concluída para pendente (limpa data e quem realizou). */
  async reopen(organizationId: string, id: string, actor: Actor) {
    const before = await this.get(organizationId, id);
    if (before.status !== 'done') throw new DomainError('validation', 'Só uma tarefa concluída pode ser reaberta');
    await this.db.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: { status: 'pending', completedOn: null, completedAt: null } });
      await tx.taskCompleter.deleteMany({ where: { taskId: id } });
      await audit(tx, organizationId, actor, 'task.reopen', 'task', id, {
        before: { status: 'done', completedOn: before.completedOn, memberIds: before.completers.map((c) => c.memberId) },
        after: { status: 'pending' },
      });
    });
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string, actor: Actor) {
    const before = await this.get(organizationId, id);
    await this.db.$transaction(async (tx) => {
      await tx.task.delete({ where: { id } });
      await audit(tx, organizationId, actor, 'task.delete', 'task', id, { before: { title: before.title, status: before.status, projectId: before.project?.id ?? null } });
    });
    return { removed: true };
  }

  /** Observação da equipe (como um comentário). O autor é quem está logado. */
  async addNote(organizationId: string, id: string, rawBody: string, actor: Actor) {
    await this.get(organizationId, id);
    const body = rawBody?.trim();
    if (!body) throw new DomainError('validation', 'Escreva a observação');
    if (body.length > TASK_NOTE_MAX) throw new DomainError('validation', `Observação com até ${TASK_NOTE_MAX} caracteres`);
    const member = actor.userId ? await this.db.organizationMember.findFirst({ where: { organizationId, userId: actor.userId }, select: { id: true } }) : null;
    await this.db.$transaction(async (tx) => {
      const n = await tx.taskNote.create({ data: { taskId: id, authorMemberId: member?.id ?? null, body } });
      await audit(tx, organizationId, actor, 'task.note.create', 'task', id, { after: { noteId: n.id, body } });
    });
    return this.get(organizationId, id);
  }

  /** Apaga uma observação: quem escreveu, ou dono/administração (`canModerate`). */
  async removeNote(organizationId: string, id: string, noteId: string, actor: Actor, canModerate: boolean) {
    await this.get(organizationId, id);
    const note = await this.db.taskNote.findFirst({ where: { id: noteId, taskId: id }, include: { author: { select: { userId: true } } } });
    if (!note) throw new DomainError('not_found', 'Observação não encontrada');
    const own = !!actor.userId && note.author?.userId === actor.userId;
    if (!own && !canModerate) throw new DomainError('forbidden', 'Só quem escreveu pode apagar a observação');
    await this.db.$transaction(async (tx) => {
      await tx.taskNote.delete({ where: { id: noteId } });
      await audit(tx, organizationId, actor, 'task.note.delete', 'task', id, { before: { noteId, body: note.body } });
    });
    return this.get(organizationId, id);
  }

  private where(organizationId: string, timezone: string, f: TeamTaskFilters): Prisma.TaskWhereInput {
    const and: Prisma.TaskWhereInput[] = [];
    if (f.projectId === 'none') and.push({ projectId: null });
    else if (f.projectId) and.push({ projectId: f.projectId });
    if (f.assigneeId) and.push({ assignees: { some: { memberId: f.assigneeId } } });
    if (f.complexity) and.push({ complexity: f.complexity });
    if (f.completedBy) and.push({ completers: { some: { memberId: f.completedBy } } });
    const q = f.q?.trim();
    if (q) and.push({ OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] });
    if (f.from || f.to) {
      for (const d of [f.from, f.to]) if (d && !ISO_DATE.test(d)) throw new DomainError('validation', 'Período inválido');
      const created: Prisma.DateTimeFilter = {};
      const done: Prisma.DateTimeFilter = {};
      if (f.from) {
        created.gte = localDayBoundsUtc(f.from, timezone).start;
        done.gte = fromIsoDate(f.from);
      }
      if (f.to) {
        created.lt = localDayBoundsUtc(f.to, timezone).end;
        done.lte = fromIsoDate(f.to);
      }
      and.push({ OR: [{ status: 'done', completedOn: done }, { status: { not: 'done' }, createdAt: created }] });
    }
    return { organizationId, ...(and.length ? { AND: and } : {}) };
  }

  private async validProject(organizationId: string, projectId?: string | null) {
    if (!projectId) return null;
    const p = await this.db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
    if (!p) throw new DomainError('not_found', 'Projeto não encontrado');
    return p.id;
  }

  private async validMembers(organizationId: string, ids?: string[]) {
    const memberIds = [...new Set(ids ?? [])];
    if (!memberIds.length) return [];
    const found = await this.db.organizationMember.count({ where: { organizationId, id: { in: memberIds } } });
    if (found !== memberIds.length) throw new DomainError('not_found', 'Pessoa da equipe não encontrada');
    return memberIds;
  }
}
