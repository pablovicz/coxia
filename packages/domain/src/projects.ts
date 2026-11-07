import type { ProjectBriefing, ProjectEvent } from '@coxia/contracts';
import type { Prisma, ProjectExpenseKind, ProjectExpenseStatus, ProjectTaskStatus, ReviewStatus } from '@coxia/database';
import { isUniqueViolation } from '@coxia/database';
import { formatBRL, formatShortDate, type IsoDate, localDateOf, normalizeText, stableHash } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError, fromIsoDate, getOrganization, toIsoDate, type Tx } from './common';

/**
 * Projetos: grupo do WhatsApp = workspace.
 * Este arquivo tem as regras puras (política de cada evento, textos) e o serviço de banco usado
 * pela api e pelo worker. A conversa no grupo fica em workspace.ts.
 */

// ───────────────────────── Regras puras ─────────────────────────

/** "PROJETO - XPO" → "XPO". Mantém a grafia original do nome do projeto. */
export function projectTitleFromGroupName(groupName: string, prefix: string): string {
  const name = groupName.trim();
  const bare = (s: string) => normalizeText(s).replace(/\s/g, '');
  const target = bare(prefix);
  // Avança caractere a caractere até cobrir o prefixo (tolera acentos e espaços internos).
  for (let i = 1; i <= name.length; i++) {
    if (bare(name.slice(0, i)) === target) {
      const rest = name.slice(i).replace(/^[\s\-‒–—―:|]+/, '').trim();
      return rest || name;
    }
  }
  return name;
}

const CLOSE_COMMAND = /^(projeto )?(encerrado|encerrar( o)?( projeto)?|pode encerrar( o projeto)?|encerra( o projeto)?)$/;

/** "encerrado", "Projeto encerrado!", "encerrar projeto" — palavra-chave determinística, sem IA. */
export function isCloseCommand(text: string): boolean {
  return CLOSE_COMMAND.test(normalizeText(text).replace(/[.!]+$/g, '').trim());
}

/** Texto que se apresenta como briefing ("Briefing: ..."). */
export function isBriefingText(text: string): boolean {
  return /^briefing\b\s*[:\-–—]?/i.test(text.trim());
}

const TRIVIAL = /^(ok+|okay|blz|beleza|show|top|valeu|obrigad[oa]s?|brigad[oa]|vlw|kkk+|haha+|rs+|sim|nao|bom dia|boa tarde|boa noite|isso|perfeito|otimo|massa|combinado|fechado|👍|🙏|❤️)[.!\s]*$/u;

/** Mensagens que não valem uma chamada à IA (agradecimentos, "ok", emojis soltos). */
export function isTrivialMessage(text: string): boolean {
  const t = normalizeText(text).replace(/[.!?,\s]+$/g, '');
  if (t.length < 3) return true;
  if (!/[\p{L}\p{N}]/u.test(t)) return true; // só emojis/pontuação
  return TRIVIAL.test(t);
}

/** Conteúdo que identifica um evento — reenvio ou reprocessamento geram o mesmo fingerprint. */
export function eventFingerprint(e: ProjectEvent): string {
  const n = (s: string | null | undefined) => (s ? normalizeText(s) : null);
  switch (e.type) {
    case 'task':
      return stableHash({ t: e.type, title: n(e.title), due: e.dueDate });
    case 'task_done':
      return stableHash({ t: e.type, title: n(e.taskTitle) });
    case 'decision':
      return stableHash({ t: e.type, summary: n(e.summary) });
    case 'quote':
    case 'expense':
      return stableHash({ t: e.type, d: n(e.description), amount: e.amountCents });
    case 'payment_proof':
      return stableHash({ t: e.type, d: n(e.description), amount: e.amountCents });
    case 'question':
      return stableHash({ t: e.type, q: n(e.question) });
    case 'close_request':
      return stableHash({ t: e.type });
  }
}

/** Confiança mínima para aplicar sem revisão humana. */
export const AUTO_APPLY_CONFIDENCE = 0.75;

export interface EventDecision {
  review: ReviewStatus;
  task?: ProjectTaskStatus;
  expense?: { kind: ProjectExpenseKind; status: ProjectExpenseStatus; withProof: boolean };
  decision?: boolean;
  taskDone?: boolean;
  /** Tentar quitar uma despesa já registrada com este comprovante. */
  matchExisting?: boolean;
  close?: boolean;
}

/**
 * Política de aplicação de eventos extraídos pela IA. A IA propõe; esta função decide.
 * - Compromisso assumido com confiança alta vira tarefa aberta; sugestão fica para revisão.
 * - Cotação nunca é despesa paga.
 * - `paid` exige comprovante; sem ele, no máximo `confirmed` (e só para quem coordena projetos).
 * - Anexo sozinho não quita nada: precisa da afirmação de pagamento (payment_proof/expense paid).
 */
export function decideEvent(e: ProjectEvent, ctx: { isManager: boolean; hasProof: boolean }): EventDecision {
  const strong = e.commitment === 'committed' && e.confidence >= AUTO_APPLY_CONFIDENCE;
  switch (e.type) {
    case 'task':
      return strong ? { review: 'auto_applied', task: 'open' } : { review: 'pending_review', task: 'proposed' };
    case 'task_done':
      return strong ? { review: 'auto_applied', taskDone: true } : { review: 'pending_review' };
    case 'decision':
      return strong && ctx.isManager ? { review: 'auto_applied', decision: true } : { review: 'pending_review' };
    case 'quote':
      return { review: 'pending_review', expense: { kind: 'quote', status: 'proposed', withProof: false } };
    case 'expense':
    case 'payment_proof': {
      const claimsPaid = e.type === 'payment_proof' || e.claimedStatus === 'paid';
      // "Paguei o buffet" quando o buffet já está lançado: quita o existente em vez de duplicar.
      const matchExisting = claimsPaid || undefined;
      if (claimsPaid && ctx.hasProof) {
        return ctx.isManager
          ? { review: 'auto_applied', expense: { kind: 'expense', status: 'paid', withProof: true }, matchExisting }
          : { review: 'pending_review', expense: { kind: 'expense', status: 'proposed', withProof: true }, matchExisting };
      }
      const incurred = e.type === 'payment_proof' || e.claimedStatus !== 'planned';
      if (strong && ctx.isManager && incurred) {
        return { review: 'auto_applied', expense: { kind: 'expense', status: 'confirmed', withProof: false }, matchExisting };
      }
      return { review: 'pending_review', expense: { kind: 'expense', status: 'proposed', withProof: false }, matchExisting };
    }
    case 'question':
      return { review: 'pending_review' };
    case 'close_request':
      return ctx.isManager ? { review: 'auto_applied', close: true } : { review: 'rejected' };
  }
}

/** Tarefa que corresponde a "terminei o cartaz": igualdade normalizada ou um título contido no outro. */
export function matchTaskTitle<T extends { title: string }>(tasks: T[], title: string): T | null {
  const target = normalizeText(title);
  const exact = tasks.filter((t) => normalizeText(t.title) === target);
  if (exact.length === 1) return exact[0]!;
  const partial = tasks.filter((t) => {
    const n = normalizeText(t.title);
    return n.includes(target) || target.includes(n);
  });
  return partial.length === 1 ? partial[0]! : null;
}

// ───────────────────────── Estado estruturado ─────────────────────────

export interface ProjectStateTask {
  id: string;
  title: string;
  assigneeName: string | null;
  dueDate: IsoDate | null;
  status: ProjectTaskStatus;
}

export interface ProjectStateExpense {
  id: string;
  kind: ProjectExpenseKind;
  description: string;
  vendor: string | null;
  amountCents: number | null;
  status: ProjectExpenseStatus;
}

/** Estado do projeto usado em resumos, prévias e no contexto da IA (nunca o chat bruto). */
export interface ProjectState {
  id: string;
  title: string;
  status: string;
  estimatedBudgetCents: number | null;
  tasks: ProjectStateTask[];
  expenses: ProjectStateExpense[];
  decisions: string[];
  openQuestions: string[];
  pendingReview: number;
}

export interface ProjectTotals {
  paidCents: number;
  /** Confirmadas e ainda não pagas. */
  committedCents: number;
  /** Propostas (despesas e cotações) aguardando validação. */
  proposedCents: number;
}

export function projectTotals(s: ProjectState): ProjectTotals {
  const sum = (f: (e: ProjectStateExpense) => boolean) => s.expenses.filter(f).reduce((acc, e) => acc + (e.amountCents ?? 0), 0);
  return {
    paidCents: sum((e) => e.status === 'paid'),
    committedCents: sum((e) => e.status === 'confirmed'),
    proposedCents: sum((e) => e.status === 'proposed'),
  };
}

const isOpenTask = (t: ProjectStateTask) => t.status === 'open' || t.status === 'proposed';

function taskLine(t: ProjectStateTask): string {
  const meta = [t.assigneeName, t.dueDate ? formatShortDate(t.dueDate) : null].filter(Boolean).join(', ');
  return `${t.title}${meta ? ` (${meta})` : ''}`;
}

function expenseLine(e: ProjectStateExpense): string {
  const what = e.kind === 'quote' ? 'cotação' : 'despesa';
  const amount = e.amountCents === null ? 'valor a confirmar' : formatBRL(e.amountCents);
  return `${e.description}${e.vendor ? ` (${e.vendor})` : ''} — ${what}, ${amount}`;
}

/** Resumo compacto para o contexto da IA: permite casar "terminei o cartaz" com a tarefa certa. */
export function projectStateText(s: ProjectState): string {
  const open = s.tasks.filter(isOpenTask);
  const lines = [`Projeto: ${s.title}`];
  lines.push(open.length ? `Tarefas em aberto:\n${open.map((t) => `- ${taskLine(t)}`).join('\n')}` : 'Tarefas em aberto: nenhuma');
  const unsettled = s.expenses.filter((e) => e.status === 'proposed' || e.status === 'confirmed');
  if (unsettled.length) lines.push(`Despesas e cotações em aberto:\n${unsettled.map((e) => `- ${expenseLine(e)}`).join('\n')}`);
  return lines.join('\n');
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Mensagem no grupo quando o workspace é ativado — inclui o aviso de privacidade e retenção. */
export function composeWorkspaceWelcome(title: string, retentionDays: number): string {
  const months = Math.round(retentionDays / 30);
  const keep = retentionDays % 365 === 0 ? `${retentionDays / 365} ano${retentionDays / 365 > 1 ? 's' : ''}` : `${months} meses`;
  return [
    `Workspace do projeto *${title}* ativado.`,
    'A partir de agora a Coxia acompanha este grupo para organizar tarefas, decisões, orçamentos e comprovantes.',
    `Aviso: as mensagens e anexos deste grupo são processados e guardados por até ${keep} para esse fim. Dúvidas, falem com a coordenação.`,
    'Para começar, mandem o briefing em áudio.',
  ].join('\n');
}

/** Confirmação do briefing estruturado, enviada ao grupo. */
export function composeBriefingConfirmation(title: string, b: ProjectBriefing): string {
  const empty =
    !b.objective && !b.deliverables.length && !b.deadlines.length && !b.owners.length && b.estimatedBudgetCents === null && !b.proposedTasks.length && !b.openQuestions.length;
  if (empty) return `Recebi o briefing de *${title}*, mas não consegui extrair detalhes. Podem mandar de novo, falando objetivo, prazos e responsáveis?`;
  const lines = [`Briefing registrado — *${title}*`];
  if (b.objective) lines.push(`Objetivo: ${b.objective}`);
  if (b.deliverables.length) lines.push('', '*Entregas*', ...b.deliverables.map((d) => `• ${d}`));
  if (b.deadlines.length) {
    lines.push('', '*Prazos*', ...b.deadlines.map((d) => `• ${d.date ? `${formatShortDate(d.date)}: ` : ''}${d.description}`));
  }
  if (b.owners.length) {
    lines.push('', '*Responsáveis*', ...b.owners.map((o) => `• ${o.name}${o.responsibility ? ` — ${o.responsibility}` : ''}`));
  }
  if (b.estimatedBudgetCents !== null) lines.push('', `Orçamento estimado: ${formatBRL(b.estimatedBudgetCents)}`);
  if (b.proposedTasks.length) {
    lines.push('', `${plural(b.proposedTasks.length, 'tarefa proposta', 'tarefas propostas')} para revisão no painel.`);
  }
  if (b.openQuestions.length) lines.push('', '*Ficou em aberto*', ...b.openQuestions.map((q) => `• ${q}`));
  return lines.join('\n');
}

/** Prévia antes de encerrar: o que ainda está pendente e quanto foi gasto. */
export function composeClosingPreview(s: ProjectState): string {
  const open = s.tasks.filter(isOpenTask);
  const unsettled = s.expenses.filter((e) => e.status === 'proposed' || e.status === 'confirmed');
  const t = projectTotals(s);
  const lines = [`Encerrar o projeto *${s.title}*?`];
  const pend: string[] = [];
  if (open.length) pend.push(`• ${plural(open.length, 'tarefa em aberto', 'tarefas em aberto')}: ${open.slice(0, 5).map(taskLine).join('; ')}${open.length > 5 ? '…' : ''}`);
  if (unsettled.length) pend.push(`• ${plural(unsettled.length, 'lançamento sem pagamento confirmado', 'lançamentos sem pagamento confirmado')}: ${unsettled.slice(0, 5).map(expenseLine).join('; ')}${unsettled.length > 5 ? '…' : ''}`);
  if (s.pendingReview) pend.push(`• ${plural(s.pendingReview, 'item aguardando revisão', 'itens aguardando revisão')} no painel`);
  if (pend.length) lines.push('', 'Ainda há pendências:', ...pend);
  else lines.push('', 'Nenhuma pendência em aberto.');
  lines.push('', financeLine(s, t));
  lines.push('', 'O histórico fica guardado. Responda SIM para encerrar.');
  return lines.join('\n');
}

function financeLine(s: ProjectState, t: ProjectTotals): string {
  const parts = [`${formatBRL(t.paidCents)} pagos`];
  if (t.committedCents) parts.push(`${formatBRL(t.committedCents)} confirmados a pagar`);
  if (s.estimatedBudgetCents !== null) parts.push(`orçamento estimado ${formatBRL(s.estimatedBudgetCents)}`);
  return `Financeiro: ${parts.join(' · ')}`;
}

/** Relatório de encerramento (também salvo em project_summaries). */
export function composeClosingReport(s: ProjectState, closedOn: IsoDate): string {
  const done = s.tasks.filter((t) => t.status === 'done');
  const open = s.tasks.filter(isOpenTask);
  const t = projectTotals(s);
  const lines = [`Projeto *${s.title}* encerrado em ${formatShortDate(closedOn)}.`, ''];
  lines.push(`Tarefas: ${done.length} concluída${done.length === 1 ? '' : 's'}${open.length ? `, ${open.length} ficaram em aberto` : ''}.`);
  if (s.decisions.length) lines.push('', '*Decisões*', ...s.decisions.map((d) => `• ${d}`));
  const paid = s.expenses.filter((e) => e.status === 'paid');
  if (paid.length) lines.push('', '*Pagos*', ...paid.map((e) => `• ${e.description}${e.vendor ? ` (${e.vendor})` : ''}: ${e.amountCents === null ? 'valor a confirmar' : formatBRL(e.amountCents)}`));
  lines.push('', financeLine(s, t));
  if (s.estimatedBudgetCents !== null && t.paidCents + t.committedCents > s.estimatedBudgetCents) {
    lines.push(`Acima do orçamento em ${formatBRL(t.paidCents + t.committedCents - s.estimatedBudgetCents)}.`);
  }
  lines.push('', 'Valeu, equipe! O histórico continua disponível no painel.');
  return lines.join('\n');
}

/**
 * Check-in diário no grupo: só sai se houver tarefa atrasada ou vencendo hoje/amanhã.
 * Automação silenciosa — sem pendência relevante, nenhuma mensagem.
 */
export function composeProjectCheckIn(s: ProjectState, today: IsoDate, tomorrow: IsoDate): string | null {
  const open = s.tasks.filter((t) => t.status === 'open' && t.dueDate);
  const overdue = open.filter((t) => t.dueDate! < today);
  const dueToday = open.filter((t) => t.dueDate === today);
  const dueTomorrow = open.filter((t) => t.dueDate === tomorrow);
  if (!overdue.length && !dueToday.length && !dueTomorrow.length) return null;
  const who = (t: ProjectStateTask) => (t.assigneeName ? ` — ${t.assigneeName}` : '');
  const lines = [`Bom dia, equipe *${s.title}*! Pendências:`];
  lines.push(...overdue.map((t) => `• Atrasada desde ${formatShortDate(t.dueDate!)}: ${t.title}${who(t)}`));
  lines.push(...dueToday.map((t) => `• Vence hoje: ${t.title}${who(t)}`));
  lines.push(...dueTomorrow.map((t) => `• Vence amanhã: ${t.title}${who(t)}`));
  lines.push('', 'Terminou alguma? É só avisar aqui.');
  return lines.join('\n');
}

// ───────────────────────── Serviço ─────────────────────────

export async function loadProjectState(db: Tx, projectId: string): Promise<ProjectState> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    include: {
      tasks: { where: { status: { not: 'cancelled' } }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] },
      expenses: { where: { status: { not: 'rejected' } }, orderBy: { createdAt: 'asc' } },
      decisions: { orderBy: { decidedAt: 'asc' } },
      events: { where: { reviewStatus: 'pending_review' }, select: { type: true, payload: true } },
    },
  });
  if (!p) throw new DomainError('not_found', 'Projeto não encontrado');
  const briefingTasksToReview = p.tasks.filter((t) => t.status === 'proposed' && !t.sourceEventId).length;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    estimatedBudgetCents: p.estimatedBudgetCents,
    tasks: p.tasks.map((t) => ({ id: t.id, title: t.title, assigneeName: t.assigneeName, dueDate: t.dueDate ? toIsoDate(t.dueDate) : null, status: t.status })),
    expenses: p.expenses.map((e) => ({ id: e.id, kind: e.kind, description: e.description, vendor: e.vendor, amountCents: e.amountCents, status: e.status })),
    decisions: p.decisions.map((d) => d.summary),
    openQuestions: p.events.filter((e) => e.type === 'question').map((e) => (e.payload as { question?: string }).question ?? ''),
    pendingReview: p.events.length + briefingTasksToReview,
  };
}

export interface ProjectPatch {
  title?: string;
  objective?: string | null;
  estimatedBudgetCents?: number | null;
  groupCheckIns?: boolean;
}

export interface TaskInput {
  title: string;
  assigneeName?: string | null;
  dueDate?: IsoDate | null;
}

export interface TaskPatch {
  title?: string;
  assigneeName?: string | null;
  dueDate?: IsoDate | null;
  status?: ProjectTaskStatus;
}

export type ExpenseAction = 'confirm' | 'reject' | 'mark_paid';

const TASK_TRANSITIONS: Record<ProjectTaskStatus, ProjectTaskStatus[]> = {
  proposed: ['open', 'done', 'cancelled'],
  open: ['done', 'cancelled'],
  done: ['open'],
  cancelled: ['open'],
};

/** CRUD e revisão de projetos (painel e WhatsApp). */
export class ProjectService {
  constructor(private readonly db: Db) {}

  /** Quem pode criar/encerrar workspaces e validar lançamentos pelo WhatsApp. */
  async canManage(organizationId: string, phone: string | null): Promise<boolean> {
    if (!phone) return false;
    const m = await this.db.organizationMember.findFirst({
      where: { organizationId, user: { phone } },
      select: { role: true, canManageProjects: true },
    });
    return !!m && (m.canManageProjects || m.role === 'owner');
  }

  /**
   * Cria o workspace para um grupo, idempotente pelo ID do grupo (nunca pelo nome).
   * Duas mensagens simultâneas do mesmo grupo: a segunda perde no unique de project_channels.
   */
  async activateFromGroup(
    organizationId: string,
    input: { whatsappGroupId: string; groupName: string; activatedByPhone: string },
    actor: Actor,
    now = new Date(),
  ): Promise<{ project: { id: string; title: string; status: string }; created: boolean }> {
    const existing = await this.db.projectChannel.findUnique({ where: { whatsappGroupId: input.whatsappGroupId }, include: { project: true } });
    if (existing) return { project: existing.project, created: false };
    const org = await getOrganization(this.db, organizationId);
    const title = projectTitleFromGroupName(input.groupName, org.projectGroupPrefix);
    try {
      const project = await this.db.$transaction(async (tx) => {
        const p = await tx.project.create({
          data: { organizationId, title, status: 'active', createdByPhone: input.activatedByPhone, activatedAt: now },
        });
        await tx.projectChannel.create({
          data: { organizationId, projectId: p.id, whatsappGroupId: input.whatsappGroupId, displayName: input.groupName, linkedAt: now },
        });
        await audit(tx, organizationId, actor, 'project.activate', 'project', p.id, { after: { title, groupName: input.groupName } });
        return p;
      });
      return { project, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.db.projectChannel.findUniqueOrThrow({ where: { whatsappGroupId: input.whatsappGroupId }, include: { project: true } });
      return { project: winner.project, created: false };
    }
  }

  /**
   * Grupo renomeado: atualiza o nome exibido. O título só acompanha se ainda for o derivado do
   * nome antigo (um título editado no painel não é sobrescrito).
   */
  async syncGroupName(organizationId: string, projectId: string, whatsappGroupId: string, groupName: string, actor: Actor): Promise<boolean> {
    const channel = await this.db.projectChannel.findUnique({ where: { whatsappGroupId }, include: { project: true } });
    if (!channel || channel.displayName === groupName) return false;
    const org = await getOrganization(this.db, organizationId);
    const oldDerived = channel.displayName ? projectTitleFromGroupName(channel.displayName, org.projectGroupPrefix) : null;
    const newTitle = projectTitleFromGroupName(groupName, org.projectGroupPrefix);
    await this.db.$transaction(async (tx) => {
      await tx.projectChannel.update({ where: { id: channel.id }, data: { displayName: groupName } });
      if (oldDerived && channel.project.title === oldDerived && newTitle !== oldDerived) {
        await tx.project.update({ where: { id: projectId }, data: { title: newTitle } });
      }
      await audit(tx, organizationId, actor, 'project.group_renamed', 'project', projectId, {
        before: { displayName: channel.displayName },
        after: { displayName: groupName },
      });
    });
    return true;
  }

  async list(organizationId: string) {
    const projects = await this.db.project.findMany({
      where: { organizationId },
      include: {
        channels: { select: { displayName: true } },
        tasks: { where: { status: { in: ['open', 'proposed'] } }, select: { status: true, dueDate: true, sourceEventId: true } },
        expenses: { where: { status: { not: 'rejected' } }, select: { status: true, amountCents: true } },
        _count: { select: { events: { where: { reviewStatus: 'pending_review' } } } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    const org = await getOrganization(this.db, organizationId);
    const today = localDateOf(new Date(), org.timezone);
    return projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      groupName: p.channels[0]?.displayName ?? null,
      activatedAt: p.activatedAt,
      closedAt: p.closedAt,
      estimatedBudgetCents: p.estimatedBudgetCents,
      openTasks: p.tasks.filter((t) => t.status === 'open').length,
      overdueTasks: p.tasks.filter((t) => t.status === 'open' && t.dueDate && toIsoDate(t.dueDate) < today).length,
      toReview: p._count.events + p.tasks.filter((t) => t.status === 'proposed' && !t.sourceEventId).length,
      paidCents: p.expenses.filter((e) => e.status === 'paid').reduce((a, e) => a + (e.amountCents ?? 0), 0),
    }));
  }

  async detail(organizationId: string, projectId: string) {
    const p = await this.db.project.findFirst({
      where: { id: projectId, organizationId },
      include: {
        channels: { select: { displayName: true, linkedAt: true } },
        tasks: { orderBy: [{ status: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] },
        expenses: { orderBy: { createdAt: 'desc' } },
        decisions: { orderBy: { decidedAt: 'desc' } },
        events: {
          where: { reviewStatus: 'pending_review', type: { in: ['decision', 'question', 'task_done'] } },
          orderBy: { createdAt: 'desc' },
        },
        summaries: { orderBy: { generatedAt: 'desc' }, take: 5 },
      },
    });
    if (!p) throw new DomainError('not_found', 'Projeto não encontrado');
    const state = await loadProjectState(this.db, p.id);
    const evidence = await this.evidenceFor(p.events.map((e) => e.sourceMessageId).concat(p.tasks.map((t) => t.sourceMessageId ?? ''), p.expenses.map((e) => e.sourceMessageId ?? '')));
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      objective: p.objective,
      briefing: p.briefing as ProjectBriefing | null,
      estimatedBudgetCents: p.estimatedBudgetCents,
      groupCheckIns: p.groupCheckIns,
      groupName: p.channels[0]?.displayName ?? null,
      activatedAt: p.activatedAt,
      closingRequestedAt: p.closingRequestedAt,
      closedAt: p.closedAt,
      totals: projectTotals(state),
      pendingReview: state.pendingReview,
      tasks: p.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        assigneeName: t.assigneeName,
        dueDate: t.dueDate ? toIsoDate(t.dueDate) : null,
        status: t.status,
        completedAt: t.completedAt,
        source: t.sourceMessageId ? (evidence.get(t.sourceMessageId) ?? null) : null,
      })),
      expenses: p.expenses.map((e) => ({
        id: e.id,
        kind: e.kind,
        description: e.description,
        vendor: e.vendor,
        amountCents: e.amountCents,
        status: e.status,
        hasProof: !!e.proofSha256 || !!e.proofAttachmentId,
        paidAt: e.paidAt,
        confirmedAt: e.confirmedAt,
        source: e.sourceMessageId ? (evidence.get(e.sourceMessageId) ?? null) : null,
      })),
      decisions: p.decisions.map((d) => ({ id: d.id, summary: d.summary, decidedAt: d.decidedAt })),
      suggestions: p.events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload as ProjectEvent,
        confidence: e.confidence,
        createdAt: e.createdAt,
        source: evidence.get(e.sourceMessageId) ?? null,
      })),
      summaries: p.summaries.map((s) => ({ id: s.id, kind: s.kind, content: s.content, generatedAt: s.generatedAt })),
    };
  }

  /** Mensagem de origem (autor, horário, texto) — a evidência mostrada ao revisar. */
  private async evidenceFor(messageIds: string[]) {
    const ids = [...new Set(messageIds.filter(Boolean))];
    const msgs = ids.length
      ? await this.db.message.findMany({
          where: { id: { in: ids } },
          select: { id: true, senderName: true, senderPhone: true, sentAt: true, text: true, attachments: { select: { kind: true, transcript: true } } },
        })
      : [];
    return new Map(
      msgs.map((m) => [
        m.id,
        {
          messageId: m.id,
          authorName: m.senderName,
          authorPhone: m.senderPhone,
          sentAt: m.sentAt,
          text: (m.text ?? m.attachments.find((a) => a.transcript)?.transcript ?? null)?.slice(0, 500) ?? null,
          attachmentKind: m.attachments[0]?.kind ?? null,
        },
      ]),
    );
  }

  private async getProject(organizationId: string, projectId: string, tx: Tx = this.db) {
    const p = await tx.project.findFirst({ where: { id: projectId, organizationId } });
    if (!p) throw new DomainError('not_found', 'Projeto não encontrado');
    return p;
  }

  async update(organizationId: string, projectId: string, patch: ProjectPatch, actor: Actor) {
    const before = await this.getProject(organizationId, projectId);
    if (patch.title !== undefined && !patch.title.trim()) throw new DomainError('validation', 'Informe o título');
    return this.db.$transaction(async (tx) => {
      const after = await tx.project.update({
        where: { id: projectId },
        data: {
          title: patch.title?.trim(),
          objective: patch.objective,
          estimatedBudgetCents: patch.estimatedBudgetCents,
          groupCheckIns: patch.groupCheckIns,
        },
      });
      await audit(tx, organizationId, actor, 'project.update', 'project', projectId, { before, after: patch });
      return after;
    });
  }

  async createTask(organizationId: string, projectId: string, input: TaskInput, actor: Actor) {
    const p = await this.getProject(organizationId, projectId);
    if (p.status === 'closed') throw new DomainError('validation', 'Projeto encerrado');
    if (!input.title.trim()) throw new DomainError('validation', 'Informe o título da tarefa');
    return this.db.$transaction(async (tx) => {
      const task = await tx.projectTask.create({
        data: {
          organizationId,
          projectId,
          title: input.title.trim(),
          assigneeName: input.assigneeName ?? null,
          dueDate: input.dueDate ? fromIsoDate(input.dueDate) : null,
          status: 'open',
        },
      });
      await audit(tx, organizationId, actor, 'project.task_create', 'project_task', task.id, { after: input });
      return task;
    });
  }

  async updateTask(organizationId: string, projectId: string, taskId: string, patch: TaskPatch, actor: Actor, tx?: Tx) {
    const run = async (t: Tx) => {
      // Trava a linha: duas revisões simultâneas não passam ambas pela checagem de transição.
      await t.$queryRaw`SELECT id FROM project_tasks WHERE id = ${taskId} FOR UPDATE`;
      const task = await t.projectTask.findFirst({ where: { id: taskId, projectId, organizationId } });
      if (!task) throw new DomainError('not_found', 'Tarefa não encontrada');
      if (patch.status && patch.status !== task.status && !TASK_TRANSITIONS[task.status].includes(patch.status)) {
        throw new DomainError('validation', `Tarefa ${task.status} não pode ir para ${patch.status}`);
      }
      if (patch.title !== undefined && !patch.title.trim()) throw new DomainError('validation', 'Informe o título da tarefa');
      const status = patch.status ?? task.status;
      const updated = await t.projectTask.update({
        where: { id: taskId },
        data: {
          title: patch.title?.trim(),
          assigneeName: patch.assigneeName,
          dueDate: patch.dueDate === undefined ? undefined : patch.dueDate ? fromIsoDate(patch.dueDate) : null,
          status,
          completedAt: status === 'done' ? (task.completedAt ?? new Date()) : null,
        },
      });
      // Revisar a proposta resolve o evento que a originou.
      if (task.status === 'proposed' && status !== 'proposed' && task.sourceEventId) {
        await this.resolveEvent(t, task.sourceEventId, status === 'cancelled' ? 'rejected' : 'confirmed', actor);
      }
      await audit(t, organizationId, actor, 'project.task_update', 'project_task', taskId, { before: task, after: patch });
      return updated;
    };
    return tx ? run(tx) : this.db.$transaction(run);
  }

  /**
   * Revisão de despesa/cotação.
   * - confirm: proposta validada → `confirmed` (com comprovante já anexado, vai direto a `paid`).
   * - mark_paid: a revisão explícita no painel conta como confirmação de pagamento.
   * - reject: descartada (fica no histórico).
   */
  async reviewExpense(organizationId: string, projectId: string, expenseId: string, action: ExpenseAction, actor: Actor, now = new Date()) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM project_expenses WHERE id = ${expenseId} FOR UPDATE`;
      const e = await tx.projectExpense.findFirst({ where: { id: expenseId, projectId, organizationId } });
      if (!e) throw new DomainError('not_found', 'Lançamento não encontrado');
      const allowed: Record<ExpenseAction, ProjectExpenseStatus[]> = {
        confirm: ['proposed'],
        mark_paid: ['proposed', 'confirmed'],
        reject: ['proposed', 'confirmed'],
      };
      if (!allowed[action].includes(e.status)) throw new DomainError('validation', `Lançamento ${e.status} não aceita esta ação`);
      const hasProof = !!e.proofSha256 || !!e.proofAttachmentId;
      const status: ProjectExpenseStatus =
        action === 'reject' ? 'rejected' : action === 'mark_paid' || (hasProof && e.kind === 'expense') ? 'paid' : 'confirmed';
      const updated = await tx.projectExpense.update({
        where: { id: e.id },
        data: {
          status,
          confirmedByPhone: status !== 'rejected' ? (actor.phone ?? e.confirmedByPhone) : e.confirmedByPhone,
          confirmedAt: status !== 'rejected' ? (e.confirmedAt ?? now) : e.confirmedAt,
          paidAt: status === 'paid' ? (e.paidAt ?? now) : e.paidAt,
        },
      });
      if (e.sourceEventId) await this.resolveEvent(tx, e.sourceEventId, status === 'rejected' ? 'rejected' : 'confirmed', actor);
      await audit(tx, organizationId, actor, `project.expense_${action}`, 'project_expense', e.id, { before: { status: e.status }, after: { status } });
      return updated;
    });
  }

  /** Revisão de sugestões sem entidade própria: decisão, pergunta, "terminei a tarefa". */
  async reviewEvent(organizationId: string, projectId: string, eventId: string, decision: 'confirm' | 'reject', actor: Actor) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM project_events WHERE id = ${eventId} FOR UPDATE`;
      const ev = await tx.projectEvent.findFirst({ where: { id: eventId, projectId, organizationId }, include: { task: true, expense: true } });
      if (!ev) throw new DomainError('not_found', 'Sugestão não encontrada');
      if (ev.reviewStatus !== 'pending_review') throw new DomainError('validation', 'Esta sugestão já foi revisada');
      if (ev.task || ev.expense) throw new DomainError('validation', 'Revise pela tarefa ou pelo lançamento correspondente');
      const payload = ev.payload as ProjectEvent;
      if (decision === 'confirm') {
        if (payload.type === 'decision') {
          await tx.projectDecision.create({
            data: { organizationId, projectId, summary: payload.summary, sourceEventId: ev.id, sourceMessageId: ev.sourceMessageId },
          });
        } else if (payload.type === 'task_done') {
          const open = await tx.projectTask.findMany({ where: { projectId, status: { in: ['open', 'proposed'] } } });
          const match = matchTaskTitle(open, payload.taskTitle);
          if (!match) throw new DomainError('validation', `Não encontrei a tarefa "${payload.taskTitle}" em aberto; conclua pela lista de tarefas`);
          await tx.projectTask.update({ where: { id: match.id }, data: { status: 'done', completedAt: new Date() } });
        }
      }
      await this.resolveEvent(tx, ev.id, decision === 'confirm' ? 'confirmed' : 'rejected', actor);
      await audit(tx, organizationId, actor, `project.event_${decision}`, 'project_event', ev.id, { after: { type: ev.type } });
    });
  }

  private async resolveEvent(tx: Tx, eventId: string, status: ReviewStatus, actor: Actor) {
    await tx.projectEvent.updateMany({
      where: { id: eventId, reviewStatus: 'pending_review' },
      data: { reviewStatus: status, reviewedByPhone: actor.phone ?? null, reviewedAt: new Date() },
    });
  }

  /** Marca o projeto como "encerrando" (aguardando confirmação) e devolve a prévia. */
  async startClosing(organizationId: string, projectId: string, actor: Actor, now = new Date()) {
    const p = await this.getProject(organizationId, projectId);
    if (p.status === 'closed') throw new DomainError('validation', 'Este projeto já está encerrado');
    await this.db.project.update({ where: { id: projectId }, data: { status: 'closing', closingRequestedAt: now } });
    await audit(this.db, organizationId, actor, 'project.closing_requested', 'project', projectId, { before: { status: p.status } });
    return composeClosingPreview(await loadProjectState(this.db, projectId));
  }

  /** Desistiu ou a confirmação expirou: volta a ativo. */
  async cancelClosing(organizationId: string, projectId: string, actor: Actor) {
    const { count } = await this.db.project.updateMany({ where: { id: projectId, organizationId, status: 'closing' }, data: { status: 'active', closingRequestedAt: null } });
    if (count) await audit(this.db, organizationId, actor, 'project.closing_cancelled', 'project', projectId);
  }

  /** Encerra: mantém todo o histórico e grava o relatório de encerramento. */
  async close(organizationId: string, projectId: string, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    return this.db.$transaction(async (tx) => {
      // Encerrar pelo painel e pelo "SIM" ao mesmo tempo: só um gera o relatório.
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const p = await this.getProject(organizationId, projectId, tx);
      if (p.status === 'closed') throw new DomainError('validation', 'Este projeto já está encerrado');
      await tx.project.update({ where: { id: projectId }, data: { status: 'closed', closedAt: now, closedByPhone: actor.phone ?? null } });
      const state = await loadProjectState(tx, projectId);
      const report = composeClosingReport(state, localDateOf(now, org.timezone));
      await tx.projectSummary.create({
        data: { organizationId, projectId, kind: 'closing', content: report, stateSnapshot: state as unknown as Prisma.InputJsonValue, generatedAt: now },
      });
      await audit(tx, organizationId, actor, 'project.close', 'project', projectId, { before: { status: p.status }, after: { status: 'closed' } });
      return { report };
    });
  }

  /** Confirmações de encerramento que expiraram devolvem o projeto a ativo. */
  async expireStaleClosings(now = new Date()): Promise<number> {
    const stale = await this.db.pendingAction.findMany({ where: { kind: 'project.close', status: 'pending', expiresAt: { lt: now } } });
    for (const pa of stale) {
      const { count } = await this.db.pendingAction.updateMany({ where: { id: pa.id, status: 'pending' }, data: { status: 'expired', resolvedAt: now } });
      if (count) await this.cancelClosing(pa.organizationId, (pa.payload as { projectId: string }).projectId, { channel: 'system' });
    }
    return stale.length;
  }
}
