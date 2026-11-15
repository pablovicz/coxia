import type { BillOccurrenceStatus, PaymentMethod, Prisma } from '@coxia/database';
import { isUniqueViolation } from '@coxia/database';
import { addDays, competenceKey, dueDateForCompetence, type IsoDate, localDateOf, normalizeText, zonedToUtc } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError, fromIsoDate, getOrganization, toIsoDate } from './common';

export const BILL_CATEGORIES = ['aluguel', 'energia', 'agua', 'internet', 'telefone', 'outros'] as const;

export interface BillInput {
  name: string;
  /** Mensal (padrão) ou pontual: um lançamento numa data (`dueOn`). */
  kind?: 'monthly' | 'one_time';
  /** Uso interno (aluguel, energia…): deduzido do nome quando não vem. */
  category?: string;
  /** Categoria cadastrada pela casa. */
  expenseCategoryId?: string | null;
  /** Multa por atraso: somada ao valor quando a conta vence sem pagamento. */
  lateFeeCents?: number | null;
  /** Lançamento pontual: a data. Para mensal, use `dueDay`. */
  dueOn?: IsoDate | null;
  dueDay: number;
  estimatedAmountCents?: number | null;
  isVariableAmount?: boolean;
  responsibleName?: string | null;
  responsiblePhone?: string | null;
  /** Mensal parcelada: total de parcelas a partir do mês de `startsOn`; null = sem fim. */
  installments?: number | null;
  /** Para quem pagar e como (PIX, conta, código de barras…). */
  payeeName?: string | null;
  paymentDetails?: string | null;
  /** Meio de pagamento: boleto, PIX ou cartão de crédito. */
  paymentMethod?: PaymentMethod | null;
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
  if (input.lateFeeCents != null && (!Number.isInteger(input.lateFeeCents) || input.lateFeeCents < 0)) {
    throw new DomainError('validation', 'Multa por atraso inválida');
  }
  if (input.kind === 'one_time' && input.dueOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn ?? '')) {
    throw new DomainError('validation', 'Informe a data do lançamento');
  }
  if (input.installments != null) {
    if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 120) {
      throw new DomainError('validation', 'Número de parcelas entre 1 e 120');
    }
    if (input.kind === 'one_time') throw new DomainError('validation', 'Parcelas só valem para conta mensal');
  }
  if (input.overdueReminderEveryDays !== undefined && input.overdueReminderEveryDays < 1) {
    throw new DomainError('validation', 'Intervalo de reaviso deve ser de pelo menos 1 dia');
  }
}

const occurrenceInclude = {
  recurringBill: {
    select: {
      id: true,
      name: true,
      kind: true,
      category: true,
      isVariableAmount: true,
      lateFeeCents: true,
      recipientPhones: true,
      installments: true,
      startsOn: true,
      payeeName: true,
      paymentDetails: true,
      paymentMethod: true,
      expenseCategory: { select: { id: true, name: true, icon: true, color: true } },
    },
  },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BillOccurrenceInclude;

export type BillOccurrenceWithBill = Prisma.BillOccurrenceGetPayload<{ include: typeof occurrenceInclude }>;

export class BillingService {
  constructor(private readonly db: Db) {}

  listBills(organizationId: string) {
    return this.db.recurringBill.findMany({
      where: { organizationId },
      include: { expenseCategory: { select: { id: true, name: true, icon: true, color: true } } },
      orderBy: [{ active: 'desc' }, { dueDay: 'asc' }, { name: 'asc' }],
    });
  }

  async getBill(organizationId: string, billId: string) {
    const bill = await this.db.recurringBill.findFirst({ where: { id: billId, organizationId } });
    if (!bill) throw new DomainError('not_found', 'Conta não encontrada');
    return bill;
  }

  async createBill(organizationId: string, input: BillInput, actor: Actor, now = new Date()) {
    const oneTime = input.kind === 'one_time';
    if (oneTime && !input.dueOn) throw new DomainError('validation', 'Informe a data do lançamento');
    validateBill(input);
    await this.assertCategory(organizationId, input.expenseCategoryId);
    // Pontual: vale só para o mês da data (início e fim = a data; vencimento = o dia dela).
    const dueOn = oneTime ? input.dueOn! : null;
    // Parcelada: começa no 1º dia do mês da primeira parcela e termina no mês da última.
    const installments = oneTime ? null : (input.installments ?? null);
    const startsOn = dueOn ?? (installments ? `${input.startsOn.slice(0, 7)}-01` : input.startsOn);
    const endsOn = dueOn ?? (installments ? installmentsEnd(startsOn, installments) : (input.endsOn ?? null));
    const bill = await this.db.$transaction(async (tx) => {
      const created = await tx.recurringBill.create({
        data: {
          organizationId,
          name: input.name.trim(),
          kind: oneTime ? 'one_time' : 'monthly',
          category: input.category ?? inferUtility(input.name),
          expenseCategoryId: input.expenseCategoryId ?? null,
          lateFeeCents: input.lateFeeCents ?? null,
          dueDay: dueOn ? Number(dueOn.slice(8, 10)) : input.dueDay,
          estimatedAmountCents: input.estimatedAmountCents ?? null,
          isVariableAmount: input.isVariableAmount ?? false,
          responsibleName: input.responsibleName ?? null,
          responsiblePhone: input.responsiblePhone ?? null,
          installments,
          payeeName: input.payeeName?.trim() || null,
          paymentDetails: input.paymentDetails?.trim() || null,
          paymentMethod: input.paymentMethod ?? null,
          recipientPhones: input.recipientPhones ?? [],
          overdueReminderEveryDays: input.overdueReminderEveryDays ?? 3,
          startsOn: fromIsoDate(startsOn),
          endsOn: endsOn ? fromIsoDate(endsOn) : null,
        },
      });
      if (dueOn) {
        // Lançamento pontual: a ocorrência nasce já, mesmo que a data seja daqui a meses.
        await tx.billOccurrence.create({
          data: {
            organizationId,
            recurringBillId: created.id,
            competence: dueOn.slice(0, 7),
            dueDate: fromIsoDate(dueOn),
            expectedAmountCents: created.estimatedAmountCents,
          },
        });
      }
      await audit(tx, organizationId, actor, 'bill.create', 'recurring_bill', created.id, { after: created });
      return created;
    });
    if (!dueOn) await this.generateOccurrences(organizationId, now);
    else await this.markOverdue(organizationId, now);
    return bill;
  }

  private async assertCategory(organizationId: string, id: string | null | undefined) {
    if (!id) return;
    const c = await this.db.expenseCategory.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!c) throw new DomainError('not_found', 'Categoria não encontrada');
  }

  /**
   * Mudança de vencimento ou de valor vale para as ocorrências ainda não pagas
   * da competência atual em diante; as pagas e as passadas não mudam.
   */
  async updateBill(organizationId: string, billId: string, patch: Partial<BillInput>, actor: Actor, now = new Date()) {
    validateBill(patch);
    await this.assertCategory(organizationId, patch.expenseCategoryId);
    const before = await this.getBill(organizationId, billId);
    const org = await getOrganization(this.db, organizationId);
    const current = competenceOf(now, org.timezone);
    // Pontual: mudar a data muda o dia e a própria ocorrência (se ainda não paga).
    if (before.kind === 'one_time' && patch.dueOn) {
      patch = { ...patch, dueDay: Number(patch.dueOn.slice(8, 10)) };
    }
    if (before.kind === 'one_time' && patch.installments != null) throw new DomainError('validation', 'Parcelas só valem para conta mensal');
    // Mudou o número de parcelas: o fim é recalculado a partir do mês da primeira.
    const installmentsChanged = before.kind === 'monthly' && patch.installments !== undefined && patch.installments !== before.installments;
    const newEnd = installmentsChanged ? (patch.installments ? installmentsEnd(toIsoDate(before.startsOn), patch.installments) : null) : undefined;

    return this.db.$transaction(async (tx) => {
      const bill = await tx.recurringBill.update({
        where: { id: billId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : patch.name !== undefined ? { category: inferUtility(patch.name) } : {}),
          ...(patch.expenseCategoryId !== undefined ? { expenseCategoryId: patch.expenseCategoryId } : {}),
          ...(patch.lateFeeCents !== undefined ? { lateFeeCents: patch.lateFeeCents } : {}),
          ...(before.kind === 'one_time' && patch.dueOn
            ? { startsOn: fromIsoDate(patch.dueOn), endsOn: fromIsoDate(patch.dueOn) }
            : {}),
          ...(patch.dueDay !== undefined ? { dueDay: patch.dueDay } : {}),
          ...(patch.estimatedAmountCents !== undefined ? { estimatedAmountCents: patch.estimatedAmountCents } : {}),
          ...(patch.isVariableAmount !== undefined ? { isVariableAmount: patch.isVariableAmount } : {}),
          ...(patch.responsibleName !== undefined ? { responsibleName: patch.responsibleName } : {}),
          ...(patch.responsiblePhone !== undefined ? { responsiblePhone: patch.responsiblePhone } : {}),
          ...(patch.recipientPhones !== undefined ? { recipientPhones: patch.recipientPhones } : {}),
          ...(patch.overdueReminderEveryDays !== undefined ? { overdueReminderEveryDays: patch.overdueReminderEveryDays } : {}),
          ...(patch.payeeName !== undefined ? { payeeName: patch.payeeName?.trim() || null } : {}),
          ...(patch.paymentDetails !== undefined ? { paymentDetails: patch.paymentDetails?.trim() || null } : {}),
          ...(patch.paymentMethod !== undefined ? { paymentMethod: patch.paymentMethod } : {}),
          ...(newEnd !== undefined
            ? { installments: patch.installments ?? null, endsOn: newEnd ? fromIsoDate(newEnd) : null }
            : patch.endsOn !== undefined
              ? { endsOn: patch.endsOn ? fromIsoDate(patch.endsOn) : null }
              : {}),
        },
      });
      // Menos parcelas: as que sobraram (geradas e não pagas) são canceladas.
      if (newEnd) {
        await tx.billOccurrence.updateMany({
          where: { recurringBillId: billId, competence: { gt: newEnd.slice(0, 7) }, paidAmountCents: 0, status: { in: UNPAID } },
          data: { status: 'cancelled' },
        });
      }

      if (before.kind === 'one_time' && patch.dueOn) {
        const today = localDateOf(now, org.timezone);
        await tx.billOccurrence.updateMany({
          where: { recurringBillId: billId, status: { in: UNPAID }, paidAmountCents: 0 },
          data: {
            dueDate: fromIsoDate(patch.dueOn),
            competence: patch.dueOn.slice(0, 7),
            status: patch.dueOn < today ? 'overdue' : 'pending',
            ...(patch.estimatedAmountCents !== undefined ? { expectedAmountCents: patch.estimatedAmountCents } : {}),
          },
        });
      } else if (patch.dueDay !== undefined || patch.estimatedAmountCents !== undefined) {
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

  /**
   * Exclui a conta com as parcelas, os pagamentos e os comprovantes (para guardar o histórico,
   * suspender). Cancela os avisos agendados das parcelas e devolve as chaves dos comprovantes
   * enviados pelo painel; os que vieram do WhatsApp continuam com a mensagem de origem.
   */
  async deleteBill(organizationId: string, billId: string, actor: Actor) {
    const bill = await this.getBill(organizationId, billId);
    const occurrences = await this.db.billOccurrence.findMany({
      where: { recurringBillId: billId },
      select: { id: true, paidAmountCents: true, payments: { select: { storageKey: true, messageAttachmentId: true } } },
    });
    const ids = occurrences.map((o) => o.id);
    const payments = occurrences.flatMap((o) => o.payments);
    await this.db.$transaction(async (tx) => {
      if (ids.length) {
        await tx.notificationSchedule.updateMany({
          where: { organizationId, targetType: 'bill_occurrence', targetId: { in: ids }, status: 'scheduled' },
          data: { status: 'cancelled' },
        });
      }
      await tx.recurringBill.delete({ where: { id: billId } });
      await audit(tx, organizationId, actor, 'bill.delete', 'recurring_bill', billId, {
        before: { name: bill.name, occurrences: ids.length, payments: payments.length, paidCents: occurrences.reduce((s, o) => s + o.paidAmountCents, 0) },
      });
    });
    return { storageKeys: payments.filter((p) => p.storageKey && !p.messageAttachmentId).map((p) => p.storageKey as string) };
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

  /**
   * Anexa um comprovante a uma conta já paga (pagamento registrado antes, sem arquivo).
   * O mesmo arquivo não vale para duas contas (unique por organização + sha256).
   */
  async attachProof(organizationId: string, occurrenceId: string, proof: { sha256: string; storageKey: string }, actor: Actor) {
    const occ = await this.db.billOccurrence.findFirst({ where: { id: occurrenceId, organizationId }, include: { recurringBill: true } });
    if (!occ) throw new DomainError('not_found', 'Conta não encontrada');
    if (occ.status !== 'paid') throw new DomainError('validation', 'Registre o pagamento junto com o comprovante');
    const dup = await this.db.paymentAttachment.findFirst({
      where: { organizationId, sha256: proof.sha256 },
      include: { billOccurrence: { include: { recurringBill: true } } },
    });
    if (dup) {
      throw new DomainError('conflict', `Este comprovante já foi registrado para ${dup.billOccurrence.recurringBill.name} (${dup.billOccurrence.competence})`, {
        code: 'duplicate_receipt',
        occurrenceId: dup.billOccurrenceId,
      });
    }
    try {
      return await this.db.$transaction(async (tx) => {
        const attachment = await tx.paymentAttachment.create({
          data: { organizationId, billOccurrenceId: occ.id, sha256: proof.sha256, storageKey: proof.storageKey },
        });
        await audit(tx, organizationId, actor, 'bill.proof_attached', 'bill_occurrence', occ.id, { after: { paymentAttachmentId: attachment.id } });
        return attachment;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('conflict', 'Este comprovante já foi registrado', { code: 'duplicate_receipt' });
      throw err;
    }
  }

  async getOccurrence(organizationId: string, occurrenceId: string) {
    const occ = await this.db.billOccurrence.findFirst({ where: { id: occurrenceId, organizationId }, include: occurrenceInclude });
    if (!occ) throw new DomainError('not_found', 'Conta não encontrada');
    return occ;
  }

  /** Um pagamento (com o comprovante) da organização, para baixar o arquivo. */
  async getPayment(organizationId: string, paymentId: string) {
    const p = await this.db.paymentAttachment.findFirst({ where: { id: paymentId, organizationId } });
    if (!p) throw new DomainError('not_found', 'Pagamento não encontrado');
    return p;
  }

  /** Contas em aberto que vencem nos próximos `days` dias, mais as atrasadas (no topo). */
  async upcoming(organizationId: string, days = 10, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const today = localDateOf(now, org.timezone);
    return this.db.billOccurrence.findMany({
      where: { organizationId, status: { in: UNPAID }, dueDate: { lte: fromIsoDate(addDays(today, days)) } },
      include: occurrenceInclude,
      orderBy: [{ dueDate: 'asc' }, { recurringBill: { name: 'asc' } }],
    });
  }

  /**
   * Detalhe de uma conta: configuração, quem cadastrou e quando, total pago, saldo devedor,
   * parcelas restantes e atrasadas (mês e valor), e o histórico mês a mês.
   */
  async details(organizationId: string, billId: string) {
    const bill = await this.db.recurringBill.findFirst({
      where: { id: billId, organizationId },
      include: {
        expenseCategory: { select: { id: true, name: true, icon: true, color: true } },
        occurrences: { orderBy: { competence: 'asc' }, include: { payments: { orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!bill) throw new DomainError('not_found', 'Conta não encontrada');
    const created = await this.db.auditEvent.findFirst({
      where: { organizationId, entityType: 'recurring_bill', entityId: billId, action: 'bill.create' },
      orderBy: { createdAt: 'asc' },
    });
    const author = created?.actorUserId
      ? await this.db.user.findUnique({ where: { id: created.actorUserId }, select: { name: true } })
      : null;

    const live = bill.occurrences.filter((o) => o.status !== 'cancelled');
    const open = live.filter((o) => UNPAID.includes(o.status));
    const openCents = (o: (typeof live)[number]) => (o.expectedAmountCents === null ? null : Math.max(o.expectedAmountCents - o.paidAmountCents, 0));
    const paidCents = live.reduce((sum, o) => sum + o.paidAmountCents, 0);

    // Parcelada: as parcelas ainda não geradas também entram no saldo devedor.
    const installments = bill.installments
      ? (() => {
          const paid = live.filter((o) => o.status === 'paid').length;
          const notGenerated = Math.max(bill.installments - live.length, 0);
          return { total: bill.installments, paid, remaining: bill.installments - paid, notGenerated };
        })()
      : null;
    const unknownAmount = open.some((o) => o.expectedAmountCents === null) || (!!installments?.notGenerated && bill.estimatedAmountCents === null);
    const outstandingCents = unknownAmount
      ? null
      : open.reduce((sum, o) => sum + (openCents(o) ?? 0), 0) + (installments?.notGenerated ?? 0) * (bill.estimatedAmountCents ?? 0);
    const overdue = open
      .filter((o) => o.status === 'overdue')
      .map((o) => ({
        occurrenceId: o.id,
        competence: o.competence,
        dueDate: toIsoDate(o.dueDate),
        openCents: openCents(o),
        lateFeeCents: bill.lateFeeCents,
        installment: installmentOf(bill, o.competence),
      }));
    const { occurrences, ...config } = bill;
    return {
      bill: config,
      createdAt: bill.createdAt,
      createdBy: created ? { name: author?.name ?? null, channel: created.actorChannel } : null,
      paidCents,
      outstandingCents,
      installments: installments ? { total: installments.total, paid: installments.paid, remaining: installments.remaining } : null,
      overdue,
      overdueCents: overdue.some((o) => o.openCents === null) ? null : overdue.reduce((s, o) => s + (o.openCents ?? 0) + (o.lateFeeCents ?? 0), 0),
      occurrences: occurrences.map((o) => ({
        id: o.id,
        competence: o.competence,
        dueDate: toIsoDate(o.dueDate),
        status: o.status,
        expectedAmountCents: o.expectedAmountCents,
        paidAmountCents: o.paidAmountCents,
        paidAt: o.paidAt,
        installment: installmentOf(bill, o.competence),
        proofs: o.payments.filter((p) => !!p.storageKey).length,
        payments: o.payments.map((p) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn ? toIsoDate(p.paidOn) : null, hasProof: !!p.storageKey })),
      })),
    };
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
   * - Concorrência: a linha da ocorrência é travada (FOR UPDATE) e tudo é lido e validado dentro
   *   da transação. Sem isso, pagamentos simultâneos liam o mesmo "já pago" e um sobrescrevia o
   *   outro (golden de concorrência da Etapa 4). O comprovante é único por organização no banco.
   */
  async registerPayment(organizationId: string, occurrenceId: string, input: PaymentInput, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    try {
      return await this.db.$transaction((tx) => this.registerPaymentLocked(tx, org.timezone, organizationId, occurrenceId, input, actor, now), {
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (err) {
      // Corrida entre dois envios do mesmo comprovante: o segundo perde no unique (organização, sha256).
      if (input.proof?.sha256 && isUniqueViolation(err)) {
        throw new DomainError('conflict', 'Este comprovante já foi registrado', { code: 'duplicate_receipt' });
      }
      throw err;
    }
  }

  private async registerPaymentLocked(
    tx: Prisma.TransactionClient,
    timezone: string,
    organizationId: string,
    occurrenceId: string,
    input: PaymentInput,
    actor: Actor,
    now: Date,
  ) {
    await tx.$queryRaw`SELECT id FROM bill_occurrences WHERE id = ${occurrenceId} AND organization_id = ${organizationId} FOR UPDATE`;
    const occ = await tx.billOccurrence.findFirst({ where: { id: occurrenceId, organizationId }, include: occurrenceInclude });
    if (!occ) throw new DomainError('not_found', 'Conta não encontrada');
    if (occ.status === 'cancelled') throw new DomainError('validation', 'Esta conta está cancelada');
    if (occ.status === 'paid') {
      throw new DomainError('conflict', `${occ.recurringBill.name} de ${occ.competence} já está paga`, { code: 'already_paid' });
    }

    // Conta variável: o previsto é só estimativa; o primeiro pagamento precisa do valor real.
    const firstVariable = occ.recurringBill.isVariableAmount && occ.paidAmountCents === 0;
    // Vencida: o valor sugerido inclui a multa por atraso.
    const fee = occ.status === 'overdue' ? (occ.recurringBill.lateFeeCents ?? 0) : 0;
    const remaining = occ.expectedAmountCents === null || firstVariable ? null : Math.max(occ.expectedAmountCents - occ.paidAmountCents, 0) + fee;
    const amount = input.amountCents ?? remaining;
    if (amount === null) throw new DomainError('validation', 'Informe o valor pago (conta com valor variável)');
    if (!Number.isInteger(amount) || amount <= 0) throw new DomainError('validation', 'Valor pago inválido');

    if (input.proof?.sha256) {
      const dup = await tx.paymentAttachment.findFirst({
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

    // Conta variável: o primeiro pagamento define o valor real (a estimativa sai de cena).
    const expected = firstVariable ? amount : (occ.expectedAmountCents ?? amount);
    const paid = occ.paidAmountCents + amount;
    const status = statusAfterPayment(expected, paid);
    const paidOn = input.paidOn ?? localDateOf(now, timezone);

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
        paidAt: status === 'paid' ? zonedToUtc(paidOn, '12:00', timezone) : occ.paidAt,
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

/** Último dia do mês da última parcela (`startsOn` no mês da primeira). */
export function installmentsEnd(startsOn: IsoDate, installments: number): IsoDate {
  const [y, m] = startsOn.split('-').map(Number) as [number, number];
  const last = (m - 1) + (installments - 1);
  return dueDateForCompetence(y + Math.floor(last / 12), (last % 12) + 1, 31);
}

/** Número da parcela de uma competência (1 = mês de `startsOn`); null se a conta não é parcelada. */
export function installmentOf(bill: { installments: number | null; startsOn: Date }, competence: string): { number: number; total: number } | null {
  if (!bill.installments) return null;
  const start = toIsoDate(bill.startsOn);
  const [sy, sm] = start.split('-').map(Number) as [number, number];
  const [cy, cm] = competence.split('-').map(Number) as [number, number];
  return { number: (cy - sy) * 12 + (cm - sm) + 1, total: bill.installments };
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { boleto: 'Boleto', pix: 'PIX', credit_card: 'Cartão de crédito' };

/** "PIX · chave 11.222…" — como pagar, nos avisos (meio e/ou dados). */
export function howToPay(b: { paymentMethod?: PaymentMethod | null; paymentDetails?: string | null }): string | null {
  const parts = [b.paymentMethod ? PAYMENT_METHOD_LABEL[b.paymentMethod] : null, b.paymentDetails?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** "Aluguel (parcela 3/10, para Imobiliária Lopes)" — nome da conta nos avisos e no briefing. */
export function billLabel(name: string, extra: { payeeName?: string | null; installment?: { number: number; total: number } | null }): string {
  const parts = [
    extra.installment ? `parcela ${extra.installment.number}/${extra.installment.total}` : null,
    extra.payeeName ? `para ${extra.payeeName}` : null,
  ].filter(Boolean);
  return parts.length ? `${name} (${parts.join(', ')})` : name;
}

/** Tipo de serviço pelo nome ("Conta de luz" → energia), para o WhatsApp achar a conta por sinônimo. */
export function inferUtility(name: string): string {
  const n = normalizeText(name);
  return Object.entries(SYNONYMS).find(([, words]) => words.some((w) => n.includes(w)))?.[0] ?? 'outros';
}

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
