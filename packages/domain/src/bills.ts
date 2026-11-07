import type { BillOccurrenceStatus, Prisma } from '@coxia/database';
import { competenceKey, dueDateForCompetence, type IsoDate, localDateOf, normalizeText, zonedToUtc } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError, fromIsoDate, getOrganization, toIsoDate } from './common';

export const BILL_CATEGORIES = ['aluguel', 'energia', 'agua', 'internet', 'telefone', 'outros'] as const;

export interface BillInput {
  name: string;
  category: string;
  dueDay: number;
  estimatedAmountCents?: number | null;
  isVariableAmount?: boolean;
  responsibleName?: string | null;
  responsiblePhone?: string | null;
  recipientPhones?: string[];
  overdueReminderEveryDays?: number;
  startsOn: IsoDate;
  endsOn?: IsoDate | null;
}

export interface PaymentInput {
  /** Sem valor: quita o restante previsto. */
  amountCents?: number | null;
  paidOn?: IsoDate | null;
  proof?: { sha256: string | null; storageKey: string | null; messageAttachmentId?: string | null } | null;
  notes?: string | null;
}

const UNPAID: BillOccurrenceStatus[] = ['pending', 'partially_paid', 'overdue'];

/** Competência (YYYY-MM) do instante no fuso da organização, deslocada em `offset` meses. */
export function competenceOf(now: Date, timezone: string, offset = 0): string {
  const [y, m] = localDateOf(now, timezone).split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + offset;
  return competenceKey(Math.floor(idx / 12), (idx % 12) + 1);
}

/** Status após um pagamento: pago quando cobre o previsto (ou quando não há previsto). */
export function statusAfterPayment(expectedCents: number | null, paidCents: number): BillOccurrenceStatus {
  if (expectedCents === null || paidCents >= expectedCents) return 'paid';
  return paidCents > 0 ? 'partially_paid' : 'pending';
}

function validateBill(input: Partial<BillInput>) {
  if (input.name !== undefined && !input.name.trim()) throw new DomainError('validation', 'Informe o nome da conta');
  if (input.dueDay !== undefined && (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31)) {
    throw new DomainError('validation', 'Dia de vencimento deve estar entre 1 e 31');
  }
  if (input.estimatedAmountCents != null && (!Number.isInteger(input.estimatedAmountCents) || input.estimatedAmountCents < 0)) {
    throw new DomainError('validation', 'Valor estimado inválido');
  }
  if (input.overdueReminderEveryDays !== undefined && input.overdueReminderEveryDays < 1) {
    throw new DomainError('validation', 'Intervalo de reaviso deve ser de pelo menos 1 dia');
  }
}

const occurrenceInclude = {
  recurringBill: { select: { id: true, name: true, category: true, isVariableAmount: true, recipientPhones: true } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BillOccurrenceInclude;

export type BillOccurrenceWithBill = Prisma.BillOccurrenceGetPayload<{ include: typeof occurrenceInclude }>;

export class BillingService {
  constructor(private readonly db: Db) {}

  listBills(organizationId: string) {
    return this.db.recurringBill.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { dueDay: 'asc' }, { name: 'asc' }] });
  }

  async getBill(organizationId: string, billId: string) {
    const bill = await this.db.recurringBill.findFirst({ where: { id: billId, organizationId } });
    if (!bill) throw new DomainError('not_found', 'Conta não encontrada');
    return bill;
  }

  async createBill(organizationId: string, input: BillInput, actor: Actor, now = new Date()) {
    validateBill(input);
    const bill = await this.db.$transaction(async (tx) => {
      const created = await tx.recurringBill.create({
        data: {
          organizationId,
          name: input.name.trim(),
          category: input.category,
          dueDay: input.dueDay,
          estimatedAmountCents: input.estimatedAmountCents ?? null,
          isVariableAmount: input.isVariableAmount ?? false,
          responsibleName: input.responsibleName ?? null,
          responsiblePhone: input.responsiblePhone ?? null,
          recipientPhones: input.recipientPhones ?? [],
          overdueReminderEveryDays: input.overdueReminderEveryDays ?? 3,
          startsOn: fromIsoDate(input.startsOn),
          endsOn: input.endsOn ? fromIsoDate(input.endsOn) : null,
        },
      });
      await audit(tx, organizationId, actor, 'bill.create', 'recurring_bill', created.id, { after: created });
      return created;
    });
    await this.generateOccurrences(organizationId, now);
    return bill;
  }

  /**
   * Mudança de vencimento ou de valor vale para as ocorrências ainda não pagas
   * da competência atual em diante; as pagas e as passadas não mudam.
   */
  async updateBill(organizationId: string, billId: string, patch: Partial<BillInput>, actor: Actor, now = new Date()) {
    validateBill(patch);
    const before = await this.getBill(organizationId, billId);
    const org = await getOrganization(this.db, organizationId);
    const current = competenceOf(now, org.timezone);

    return this.db.$transaction(async (tx) => {
      const bill = await tx.recurringBill.update({
        where: { id: billId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.dueDay !== undefined ? { dueDay: patch.dueDay } : {}),
          ...(patch.estimatedAmountCents !== undefined ? { estimatedAmountCents: patch.estimatedAmountCents } : {}),
          ...(patch.isVariableAmount !== undefined ? { isVariableAmount: patch.isVariableAmount } : {}),
          ...(patch.responsibleName !== undefined ? { responsibleName: patch.responsibleName } : {}),
          ...(patch.responsiblePhone !== undefined ? { responsiblePhone: patch.responsiblePhone } : {}),
          ...(patch.recipientPhones !== undefined ? { recipientPhones: patch.recipientPhones } : {}),
          ...(patch.overdueReminderEveryDays !== undefined ? { overdueReminderEveryDays: patch.overdueReminderEveryDays } : {}),
          ...(patch.endsOn !== undefined ? { endsOn: patch.endsOn ? fromIsoDate(patch.endsOn) : null } : {}),
        },
      });

      if (patch.dueDay !== undefined || patch.estimatedAmountCents !== undefined) {
        const open = await tx.billOccurrence.findMany({
          where: { recurringBillId: billId, competence: { gte: current }, status: { in: UNPAID } },
        });
        const today = localDateOf(now, org.timezone);
        for (const o of open) {
          const [y, m] = o.competence.split('-').map(Number) as [number, number];
          const dueDate = dueDateForCompetence(y, m, bill.dueDay);
          const expected = bill.estimatedAmountCents;
          const status = o.paidAmountCents > 0 ? statusAfterPayment(expected, o.paidAmountCents) : dueDate < today ? 'overdue' : 'pending';
          await tx.billOccurrence.update({
            where: { id: o.id },
            data: { dueDate: fromIsoDate(dueDate), expectedAmountCents: expected, status },
          });
        }
      }
      await audit(tx, organizationId, actor, 'bill.update', 'recurring_bill', billId, { before, after: bill });
      return bill;
    });
  }

  /** Suspende: para de gerar e cancela as ocorrências em aberto que ainda não venceram. */
  async suspendBill(organizationId: string, billId: string, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    await this.getBill(organizationId, billId);
    const today = fromIsoDate(localDateOf(now, org.timezone));
    return this.db.$transaction(async (tx) => {
      const bill = await tx.recurringBill.update({ where: { id: billId }, data: { active: false, suspendedAt: now } });
      const { count } = await tx.billOccurrence.updateMany({
        where: { recurringBillId: billId, status: 'pending', paidAmountCents: 0, dueDate: { gte: today } },
        data: { status: 'cancelled' },
      });
      await audit(tx, organizationId, actor, 'bill.suspend', 'recurring_bill', billId, { after: { cancelledOccurrences: count } });
      return bill;
    });
  }

  async reactivateBill(organizationId: string, billId: string, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    await this.getBill(organizationId, billId);
    const today = fromIsoDate(localDateOf(now, org.timezone));
    const bill = await this.db.$transaction(async (tx) => {
      const b = await tx.recurringBill.update({ where: { id: billId }, data: { active: true, suspendedAt: null } });
      await tx.billOccurrence.updateMany({
        where: { recurringBillId: billId, status: 'cancelled', paidAmountCents: 0, dueDate: { gte: today } },
        data: { status: 'pending' },
      });
      await audit(tx, organizationId, actor, 'bill.reactivate', 'recurring_bill', billId);
      return b;
    });
    await this.generateOccurrences(organizationId, now);
    return bill;
  }

  /**
   * Gera as ocorrências da competência atual e da próxima. Idempotente: o unique
   * (recurring_bill_id, competence) garante uma ocorrência por mês, mesmo com execuções repetidas.
   */
  async generateOccurrences(organizationId: string, now = new Date()): Promise<number> {
    const org = await getOrganization(this.db, organizationId);
    const competences = [competenceOf(now, org.timezone), competenceOf(now, org.timezone, 1)];
    const bills = await this.db.recurringBill.findMany({ where: { organizationId, active: true } });
    const data: Prisma.BillOccurrenceCreateManyInput[] = [];
    for (const bill of bills) {
      for (const competence of competences) {
        const [y, m] = competence.split('-').map(Number) as [number, number];
        const monthStart = `${competence}-01`;
        const monthEnd = dueDateForCompetence(y, m, 31);
        if (toIsoDate(bill.startsOn) > monthEnd) continue;
        if (bill.endsOn && toIsoDate(bill.endsOn) < monthStart) continue;
        data.push({
          organizationId,
          recurringBillId: bill.id,
          competence,
          dueDate: fromIsoDate(dueDateForCompetence(y, m, bill.dueDay)),
          expectedAmountCents: bill.estimatedAmountCents,
        });
      }
    }
    if (data.length === 0) return 0;
    const { count } = await this.db.billOccurrence.createMany({ data, skipDuplicates: true });
    return count;
  }

  /** Marca como atrasadas as ocorrências não pagas com vencimento anterior a hoje (local). */
  async markOverdue(organizationId: string, now = new Date()): Promise<number> {
    const org = await getOrganization(this.db, organizationId);
    const today = fromIsoDate(localDateOf(now, org.timezone));
    const { count } = await this.db.billOccurrence.updateMany({
      where: { organizationId, status: { in: ['pending', 'partially_paid'] }, dueDate: { lt: today } },
      data: { status: 'overdue' },
    });
    return count;
  }

  listOccurrences(organizationId: string, competence: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) throw new DomainError('validation', 'Competência inválida (use YYYY-MM)');
    return this.db.billOccurrence.findMany({
      where: { organizationId, competence },
      include: occurrenceInclude,
      orderBy: [{ dueDate: 'asc' }, { recurringBill: { name: 'asc' } }],
    });
  }

  /** Ocorrências em aberto (inclusive de meses anteriores), por vencimento. */
  listOpen(organizationId: string) {
    return this.db.billOccurrence.findMany({
      where: { organizationId, status: { in: UNPAID } },
      include: occurrenceInclude,
      orderBy: { dueDate: 'asc' },
    });
  }

  async summary(organizationId: string, competence: string) {
    const occurrences = await this.listOccurrences(organizationId, competence);
    const active = occurrences.filter((o) => o.status !== 'cancelled');
    return {
      competence,
      expectedCents: active.reduce((s, o) => s + (o.expectedAmountCents ?? 0), 0),
      paidCents: active.reduce((s, o) => s + o.paidAmountCents, 0),
      total: active.length,
      paid: active.filter((o) => o.status === 'paid').length,
      pending: active.filter((o) => o.status === 'pending' || o.status === 'partially_paid').length,
      overdue: active.filter((o) => o.status === 'overdue').length,
      variableWithoutAmount: active.filter((o) => o.expectedAmountCents === null).length,
    };
  }

  /**
   * Registra pagamento (total, parcial ou antecipado).
   * - Comprovante já usado (mesmo sha256) é rejeitado.
   * - Ocorrência já paga não aceita novo pagamento.
   */
  async registerPayment(organizationId: string, occurrenceId: string, input: PaymentInput, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const occ = await this.db.billOccurrence.findFirst({ where: { id: occurrenceId, organizationId }, include: occurrenceInclude });
    if (!occ) throw new DomainError('not_found', 'Conta não encontrada');
    if (occ.status === 'cancelled') throw new DomainError('validation', 'Esta conta está cancelada');
    if (occ.status === 'paid') {
      throw new DomainError('conflict', `${occ.recurringBill.name} de ${occ.competence} já está paga`, { code: 'already_paid' });
    }

    const remaining = occ.expectedAmountCents === null ? null : Math.max(occ.expectedAmountCents - occ.paidAmountCents, 0);
    const amount = input.amountCents ?? remaining;
    if (amount === null) throw new DomainError('validation', 'Informe o valor pago (conta com valor variável)');
    if (!Number.isInteger(amount) || amount <= 0) throw new DomainError('validation', 'Valor pago inválido');

    if (input.proof?.sha256) {
      const dup = await this.db.paymentAttachment.findFirst({
        where: { organizationId, sha256: input.proof.sha256 },
        include: { billOccurrence: { include: { recurringBill: true } } },
      });
      if (dup) {
        throw new DomainError(
          'conflict',
          `Este comprovante já foi registrado para ${dup.billOccurrence.recurringBill.name} (${dup.billOccurrence.competence})`,
          { code: 'duplicate_receipt', occurrenceId: dup.billOccurrenceId },
        );
      }
    }

    // Conta variável sem previsto: o primeiro pagamento define o valor real.
    const expected = occ.expectedAmountCents ?? amount;
    const paid = occ.paidAmountCents + amount;
    const status = statusAfterPayment(expected, paid);
    const paidOn = input.paidOn ?? localDateOf(now, org.timezone);

    return this.db.$transaction(async (tx) => {
      await tx.paymentAttachment.create({
        data: {
          organizationId,
          billOccurrenceId: occ.id,
          amountCents: amount,
          paidOn: fromIsoDate(paidOn),
          sha256: input.proof?.sha256 ?? null,
          storageKey: input.proof?.storageKey ?? null,
          messageAttachmentId: input.proof?.messageAttachmentId ?? null,
        },
      });
      const updated = await tx.billOccurrence.update({
        where: { id: occ.id },
        data: {
          expectedAmountCents: expected,
          paidAmountCents: paid,
          status,
          paidAt: status === 'paid' ? zonedToUtc(paidOn, '12:00', org.timezone) : occ.paidAt,
          confirmedByPhone: actor.phone ?? occ.confirmedByPhone,
          sourceMessageId: actor.sourceMessageId ?? occ.sourceMessageId,
          notes: input.notes ?? occ.notes,
        },
        include: occurrenceInclude,
      });
      await audit(tx, organizationId, actor, 'bill.payment', 'bill_occurrence', occ.id, {
        before: { status: occ.status, paidAmountCents: occ.paidAmountCents },
        after: { status, paidAmountCents: paid, amountCents: amount, paidOn },
      });
      return { occurrence: updated, amountCents: amount, remainingCents: Math.max(expected - paid, 0) };
    });
  }

  /** "energia", "conta de luz", "aluguel" → conta. */
  async resolveHint(organizationId: string, hint: string) {
    const bills = await this.db.recurringBill.findMany({ where: { organizationId, active: true } });
    return resolveBillHint(bills, hint);
  }

  /** Ocorrência em aberto mais antiga da conta (a que um "paguei a energia" quer quitar). */
  oldestOpenOccurrence(billId: string): Promise<BillOccurrenceWithBill | null> {
    return this.db.billOccurrence.findFirst({
      where: { recurringBillId: billId, status: { in: UNPAID } },
      include: occurrenceInclude,
      orderBy: { dueDate: 'asc' },
    });
  }
}

const SYNONYMS: Record<string, string[]> = {
  energia: ['luz', 'energia', 'eletrica', 'enel', 'cpfl', 'cemig', 'light'],
  agua: ['agua', 'sabesp', 'saneamento'],
  internet: ['internet', 'wifi', 'banda larga'],
  telefone: ['telefone', 'celular', 'linha'],
  aluguel: ['aluguel', 'locacao'],
};

export function resolveBillHint<B extends { name: string; category: string }>(bills: B[], hint: string): { match: B | null; candidates: B[] } {
  const h = normalizeText(hint).replace(/^(a|o|conta de|conta da|conta do)\s+/, '');
  const byName = bills.filter((b) => normalizeText(b.name) === h || normalizeText(b.name).includes(h) || h.includes(normalizeText(b.name)));
  if (byName.length === 1) return { match: byName[0]!, candidates: byName };
  const category = Object.entries(SYNONYMS).find(([, words]) => words.some((w) => h.includes(w)))?.[0];
  const byCategory = category ? bills.filter((b) => b.category === category) : [];
  if (byCategory.length === 1) return { match: byCategory[0]!, candidates: byCategory };
  const candidates = byName.length ? byName : byCategory;
  return { match: null, candidates: candidates.length ? candidates : bills };
}
