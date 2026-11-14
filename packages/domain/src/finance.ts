import { localDateOf } from '@coxia/shared';
import { type Db, DomainError, fromIsoDate, getOrganization, toIsoDate } from './common';

export interface FinanceMonth {
  competence: string;
  incomeExpectedCents: number;
  incomeReceivedCents: number;
  billsExpectedCents: number;
  billsPaidCents: number;
  /** Contas e entradas atrasadas do mês (vencidas e não pagas/recebidas). */
  billsOverdue: number;
  incomesOverdue: number;
  /** Contas de valor variável ainda sem valor. */
  variableWithoutAmount: number;
}

/**
 * Visão unificada do Financeiro: entradas e saídas mês a mês num ano, com o mês atual
 * marcado. Os vencimentos mensais são gerados para o mês atual e o próximo; meses mais
 * à frente mostram só o que já existe (lançamentos pontuais, parcelas geradas, entradas).
 */
export class FinanceService {
  constructor(private readonly db: Db) {}

  async year(organizationId: string, year: number, now = new Date()) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new DomainError('validation', 'Ano inválido');
    const org = await getOrganization(this.db, organizationId);
    const today = localDateOf(now, org.timezone);
    const [occurrences, incomes] = await Promise.all([
      this.db.billOccurrence.findMany({
        where: { organizationId, status: { not: 'cancelled' }, competence: { gte: `${year}-01`, lte: `${year}-12` } },
        select: { competence: true, expectedAmountCents: true, paidAmountCents: true, status: true },
      }),
      this.db.income.findMany({
        where: { organizationId, status: { not: 'cancelled' }, expectedOn: { gte: fromIsoDate(`${year}-01-01`), lte: fromIsoDate(`${year}-12-31`) } },
        select: { expectedOn: true, amountCents: true, receivedAmountCents: true, status: true },
      }),
    ]);

    const months: FinanceMonth[] = Array.from({ length: 12 }, (_, i) => ({
      competence: `${year}-${String(i + 1).padStart(2, '0')}`,
      incomeExpectedCents: 0,
      incomeReceivedCents: 0,
      billsExpectedCents: 0,
      billsPaidCents: 0,
      billsOverdue: 0,
      incomesOverdue: 0,
      variableWithoutAmount: 0,
    }));
    const at = (competence: string) => months[Number(competence.slice(5, 7)) - 1]!;

    for (const o of occurrences) {
      const m = at(o.competence);
      // Mesmo critério do resumo do mês: o previsto (ou o pago, se passou do previsto).
      m.billsExpectedCents += o.expectedAmountCents ?? 0;
      m.billsPaidCents += o.paidAmountCents;
      if (o.status === 'overdue') m.billsOverdue++;
      if (o.expectedAmountCents === null) m.variableWithoutAmount++;
    }
    for (const i of incomes) {
      const date = toIsoDate(i.expectedOn);
      const m = at(date.slice(0, 7));
      const value = i.status === 'received' ? (i.receivedAmountCents ?? i.amountCents) : i.amountCents;
      m.incomeExpectedCents += value;
      if (i.status === 'received') m.incomeReceivedCents += value;
      if (i.status === 'expected' && date < today) m.incomesOverdue++;
    }

    const sum = (k: keyof Omit<FinanceMonth, 'competence'>) => months.reduce((s, m) => s + m[k], 0);
    return {
      year,
      currentCompetence: today.slice(0, 7),
      months,
      totals: {
        incomeExpectedCents: sum('incomeExpectedCents'),
        incomeReceivedCents: sum('incomeReceivedCents'),
        billsExpectedCents: sum('billsExpectedCents'),
        billsPaidCents: sum('billsPaidCents'),
        billsOverdue: sum('billsOverdue'),
        incomesOverdue: sum('incomesOverdue'),
      },
    };
  }
}
