import type { IncomeSource, Prisma } from '@coxia/database';
import { dueDateForCompetence, localDateOf } from '@coxia/shared';
import { competenceOf } from './bills';
import { type Actor, audit, type Db, DomainError, fromIsoDate, getOrganization, toIsoDate } from './common';

export interface IncomeInput {
  source: IncomeSource;
  description: string;
  amountCents: number;
  expectedOn: string; // YYYY-MM-DD
  payerName?: string | null;
  notes?: string | null;
  projectId?: string | null;
  spaceId?: string | null;
}

const COMPETENCE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const incomeInclude = {
  project: { select: { id: true, title: true } },
  space: { select: { id: true, name: true, color: true, icon: true } },
} satisfies Prisma.IncomeInclude;

/**
 * Entradas de dinheiro: previstas (com data) e recebidas. Projeto (patrocínio, parcela,
 * bilheteria), aluguel de sala (o mensal é gerado sozinho a partir da sala alugada) ou outra.
 * "Atrasada" = prevista com data já passada; não é guardada, é calculada.
 */
export class IncomeService {
  constructor(private readonly db: Db) {}

  /** Entradas com data prevista no mês (YYYY-MM), mais as atrasadas de meses anteriores ainda em aberto. */
  async list(organizationId: string, competence: string) {
    if (!COMPETENCE.test(competence)) throw new DomainError('validation', 'Competência inválida (use YYYY-MM)');
    const [y, m] = competence.split('-').map(Number) as [number, number];
    const start = fromIsoDate(`${competence}-01`);
    const end = fromIsoDate(dueDateForCompetence(y, m, 31));
    return this.db.income.findMany({
      where: {
        organizationId,
        OR: [{ expectedOn: { gte: start, lte: end } }, { status: 'expected', expectedOn: { lt: start } }],
      },
      include: incomeInclude,
      orderBy: [{ expectedOn: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listForProject(organizationId: string, projectId: string) {
    return this.db.income.findMany({
      where: { organizationId, projectId },
      include: incomeInclude,
      orderBy: [{ expectedOn: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Resumo do mês: previsto (sem canceladas), recebido e quantas estão atrasadas (de qualquer mês). */
  async summary(organizationId: string, competence: string, now = new Date()) {
    if (!COMPETENCE.test(competence)) throw new DomainError('validation', 'Competência inválida (use YYYY-MM)');
    const org = await getOrganization(this.db, organizationId);
    const [y, m] = competence.split('-').map(Number) as [number, number];
    const start = fromIsoDate(`${competence}-01`);
    const end = fromIsoDate(dueDateForCompetence(y, m, 31));
    const today = fromIsoDate(localDateOf(now, org.timezone));
    const [month, overdue] = await Promise.all([
      this.db.income.findMany({ where: { organizationId, status: { not: 'cancelled' }, expectedOn: { gte: start, lte: end } } }),
      this.db.income.count({ where: { organizationId, status: 'expected', expectedOn: { lt: today } } }),
    ]);
    return {
      competence,
      expectedCents: month.reduce((s, i) => s + (i.status === 'received' ? (i.receivedAmountCents ?? i.amountCents) : i.amountCents), 0),
      receivedCents: month.filter((i) => i.status === 'received').reduce((s, i) => s + (i.receivedAmountCents ?? i.amountCents), 0),
      total: month.length,
      received: month.filter((i) => i.status === 'received').length,
      overdue,
    };
  }

  async create(organizationId: string, input: IncomeInput, actor: Actor) {
    const data = await this.validate(organizationId, input);
    return this.db.$transaction(async (tx) => {
      const income = await tx.income.create({ data: { organizationId, ...data }, include: incomeInclude });
      await audit(tx, organizationId, actor, 'income.create', 'income', income.id, { after: income });
      return income;
    });
  }

  async update(organizationId: string, incomeId: string, patch: Partial<IncomeInput>, actor: Actor) {
    const before = await this.get(organizationId, incomeId);
    if (before.status !== 'expected') throw new DomainError('validation', 'Só entradas previstas podem ser alteradas');
    const merged: IncomeInput = {
      source: patch.source ?? before.source,
      description: patch.description ?? before.description,
      amountCents: patch.amountCents ?? before.amountCents,
      expectedOn: patch.expectedOn ?? toIsoDate(before.expectedOn),
      payerName: patch.payerName !== undefined ? patch.payerName : before.payerName,
      notes: patch.notes !== undefined ? patch.notes : before.notes,
      projectId: patch.projectId !== undefined ? patch.projectId : before.projectId,
      spaceId: patch.spaceId !== undefined ? patch.spaceId : before.spaceId,
    };
    const data = await this.validate(organizationId, merged);
    return this.db.$transaction(async (tx) => {
      const income = await tx.income.update({ where: { id: incomeId }, data, include: incomeInclude });
      await audit(tx, organizationId, actor, 'income.update', 'income', incomeId, { before, after: income });
      return income;
    });
  }

  /** Marca como recebida. Valor e data padrão: o previsto e hoje. Não recebe duas vezes (lock da linha). */
  async receive(organizationId: string, incomeId: string, input: { amountCents?: number; receivedOn?: string }, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    if (input.receivedOn !== undefined && !ISO_DATE.test(input.receivedOn)) throw new DomainError('validation', 'Data inválida');
    if (input.amountCents !== undefined && (!Number.isInteger(input.amountCents) || input.amountCents <= 0)) {
      throw new DomainError('validation', 'Valor recebido inválido');
    }
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM incomes WHERE id = ${incomeId} AND organization_id = ${organizationId} FOR UPDATE`;
      const income = await tx.income.findFirst({ where: { id: incomeId, organizationId } });
      if (!income) throw new DomainError('not_found', 'Entrada não encontrada');
      if (income.status === 'received') throw new DomainError('conflict', 'Esta entrada já foi recebida', { code: 'already_received' });
      if (income.status === 'cancelled') throw new DomainError('validation', 'Esta entrada está cancelada');
      const updated = await tx.income.update({
        where: { id: incomeId },
        data: {
          status: 'received',
          receivedAmountCents: input.amountCents ?? income.amountCents,
          receivedOn: fromIsoDate(input.receivedOn ?? localDateOf(now, org.timezone)),
        },
        include: incomeInclude,
      });
      await audit(tx, organizationId, actor, 'income.receive', 'income', incomeId, {
        before: { status: income.status },
        after: { status: 'received', receivedAmountCents: updated.receivedAmountCents, receivedOn: updated.receivedOn },
      });
      return updated;
    });
  }

  async cancel(organizationId: string, incomeId: string, actor: Actor) {
    const income = await this.get(organizationId, incomeId);
    if (income.status === 'received') throw new DomainError('validation', 'Entrada recebida não pode ser cancelada');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.income.update({ where: { id: incomeId }, data: { status: 'cancelled' }, include: incomeInclude });
      await audit(tx, organizationId, actor, 'income.cancel', 'income', incomeId, { before: { status: income.status } });
      return updated;
    });
  }

  /**
   * Aluguel mensal das salas alugadas: uma entrada por sala no mês atual e no próximo.
   * Idempotente pelo unique (sala, competência). Sala que deixou de ser alugada não gera mais.
   */
  async generateRentals(organizationId: string, now = new Date()): Promise<number> {
    const org = await getOrganization(this.db, organizationId);
    const competences = [competenceOf(now, org.timezone), competenceOf(now, org.timezone, 1)];
    const spaces = await this.db.space.findMany({
      where: { organizationId, active: true, status: 'monthly_rental', rentAmountCents: { gt: 0 }, rentDueDay: { not: null } },
    });
    const data: Prisma.IncomeCreateManyInput[] = [];
    for (const s of spaces) {
      for (const competence of competences) {
        const [y, m] = competence.split('-').map(Number) as [number, number];
        data.push({
          organizationId,
          source: 'room_rental',
          description: `Aluguel ${s.name}`,
          amountCents: s.rentAmountCents!,
          expectedOn: fromIsoDate(dueDateForCompetence(y, m, s.rentDueDay!)),
          payerName: s.tenantName,
          spaceId: s.id,
          competence,
        });
      }
    }
    if (!data.length) return 0;
    const { count } = await this.db.income.createMany({ data, skipDuplicates: true });
    return count;
  }

  /**
   * A sala mudou (valor, dia, inquilino ou deixou de ser alugada): ajusta os aluguéis ainda
   * previstos a partir de hoje. Os já recebidos e os atrasados ficam como estão.
   */
  async syncRentalsOfSpace(organizationId: string, spaceId: string, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const today = fromIsoDate(localDateOf(now, org.timezone));
    const space = await this.db.space.findFirstOrThrow({ where: { id: spaceId, organizationId } });
    const rented = space.active && space.status === 'monthly_rental' && !!space.rentAmountCents && !!space.rentDueDay;
    const upcoming = await this.db.income.findMany({ where: { spaceId, competence: { not: null }, status: 'expected', expectedOn: { gte: today } } });
    for (const inc of upcoming) {
      if (!rented) {
        await this.db.income.update({ where: { id: inc.id }, data: { status: 'cancelled' } });
        continue;
      }
      const [y, m] = inc.competence!.split('-').map(Number) as [number, number];
      await this.db.income.update({
        where: { id: inc.id },
        data: {
          amountCents: space.rentAmountCents!,
          expectedOn: fromIsoDate(dueDateForCompetence(y, m, space.rentDueDay!)),
          payerName: space.tenantName,
          description: `Aluguel ${space.name}`,
        },
      });
    }
    if (rented) await this.generateRentals(organizationId, now);
  }

  private async get(organizationId: string, incomeId: string) {
    const income = await this.db.income.findFirst({ where: { id: incomeId, organizationId } });
    if (!income) throw new DomainError('not_found', 'Entrada não encontrada');
    return income;
  }

  private async validate(organizationId: string, input: IncomeInput) {
    const description = input.description.trim();
    if (!description) throw new DomainError('validation', 'Descreva a entrada');
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new DomainError('validation', 'Informe o valor da entrada');
    if (!ISO_DATE.test(input.expectedOn)) throw new DomainError('validation', 'Informe a data prevista');
    if (input.source === 'project' && !input.projectId) throw new DomainError('validation', 'Escolha o projeto');
    if (input.projectId) {
      const p = await this.db.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } });
      if (!p) throw new DomainError('not_found', 'Projeto não encontrado');
    }
    if (input.spaceId) {
      const s = await this.db.space.findFirst({ where: { id: input.spaceId, organizationId }, select: { id: true } });
      if (!s) throw new DomainError('not_found', 'Sala não encontrada');
    }
    return {
      source: input.source,
      description,
      amountCents: input.amountCents,
      expectedOn: fromIsoDate(input.expectedOn),
      payerName: input.payerName?.trim() || null,
      notes: input.notes?.trim() || null,
      projectId: input.source === 'project' ? input.projectId! : null,
      spaceId: input.source === 'room_rental' ? (input.spaceId ?? null) : null,
    };
  }
}
