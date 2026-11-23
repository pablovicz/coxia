import type { Prisma, ResidentContract } from '@coxia/database';
import {
  cycleBounds,
  cycleForDate,
  dueDateForCompetence,
  type IsoDate,
  localDateOf,
  localDayBoundsUtc,
  openCycles,
  shiftCycleKey,
} from '@coxia/shared';
import {
  type Actor,
  audit,
  type Db,
  type DomainEventPublisher,
  DomainError,
  emit,
  fromIsoDate,
  getOrganization,
  NO_EVENTS,
  toIsoDate,
  type Tx,
} from './common';
import { type BalanceGrant, type BalanceOccurrence, cycleBalance, cycleLedger } from './hour-balance';
import { enqueueBookingEmails } from './resident-emails';

export interface ContractInput {
  spaceId: string;
  /** Horas por ciclo, em minutos (múltiplo de 30). */
  monthlyMinutes: number;
  monthlyAmountCents?: number | null;
  paymentDueDay?: number | null;
  cycleDay: number;
  bookingOpensDay: number;
  startsOn: IsoDate;
  endsOn?: IsoDate | null;
  notes?: string | null;
}

/** Mensalidade do ciclo: o saldo só é liberado com ela paga (contratos com mensalidade). */
export type CyclePayment =
  | { status: 'not_required' }
  | { status: 'none' }
  | { status: 'paid' | 'pending'; incomeId: string; dueOn: string; amountCents: number };

export const contractInclude = {
  space: { select: { id: true, name: true, color: true, icon: true, slug: true } },
  resident: { select: { id: true, name: true, contactId: true, email: true } },
} satisfies Prisma.ResidentContractInclude;

export type ContractWithRelations = Prisma.ResidentContractGetPayload<{ include: typeof contractInclude }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function day(value: number | null | undefined, label: string, required = true) {
  if (value == null) {
    if (required) throw new DomainError('validation', `Informe o ${label}`);
    return;
  }
  if (!Number.isInteger(value) || value < 1 || value > 31) throw new DomainError('validation', `${label[0]!.toUpperCase()}${label.slice(1)} entre 1 e 31`);
}

export function contractTerms(c: Pick<ResidentContract, 'cycleDay' | 'bookingOpensDay' | 'startsOn' | 'endsOn'>) {
  return { cycleDay: c.cycleDay, bookingOpensDay: c.bookingOpensDay, startsOn: toIsoDate(c.startsOn), endsOn: c.endsOn ? toIsoDate(c.endsOn) : null };
}

/** Contrato vigente (ativo e não terminado) na data. */
export function isContractLive(c: Pick<ResidentContract, 'status' | 'startsOn' | 'endsOn'>, today: IsoDate) {
  return c.status === 'active' && (!c.endsOn || toIsoDate(c.endsOn) >= today);
}

export class ResidentContractService {
  constructor(
    private readonly db: Db,
    private readonly events: DomainEventPublisher = NO_EVENTS,
  ) {}

  // ───────────── consultas ─────────────

  async list(organizationId: string, residentId: string, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const contracts = await this.db.residentContract.findMany({
      where: { organizationId, residentId },
      include: contractInclude,
      orderBy: [{ status: 'asc' }, { startsOn: 'desc' }],
    });
    return Promise.all(contracts.map(async (c) => ({ ...c, balance: await this.summary(c, org.timezone, now) })));
  }

  async get(organizationId: string, id: string) {
    const c = await this.db.residentContract.findFirst({ where: { id, organizationId }, include: contractInclude });
    if (!c) throw new DomainError('not_found', 'Contrato não encontrado');
    return c;
  }

  /** Saldo do ciclo atual e, se a agenda já abriu, do próximo; com o extrato de cada um. */
  async balance(organizationId: string, id: string, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const contract = await this.get(organizationId, id);
    await this.ensureGrants(contract, org.timezone, now);
    const { grants, occurrences } = await this.ledgerData(this.db, contract.id);
    const terms = { cycleDay: contract.cycleDay, timezone: org.timezone };
    const today = localDateOf(now, org.timezone);
    const current = cycleForDate(today, contract.cycleDay).key;
    const open = openCycles(contractTerms(contract), today);
    const keys = [...new Set([current, ...open.map((c) => c.key)])].sort();
    const payment = await this.paymentsOf(contract, keys);
    return {
      contract,
      open,
      cycles: keys.map((key) => ({
        ...cycleBalance(key, grants, occurrences, terms, now),
        payment: payment(key),
        ledger: cycleLedger(key, grants, occurrences, terms, now),
      })),
    };
  }

  /** Resumo para listas: ciclo atual e o próximo (se aberto). */
  async summary(contract: ResidentContract, timezone: string, now = new Date()) {
    await this.ensureGrants(contract, timezone, now);
    const { grants, occurrences } = await this.ledgerData(this.db, contract.id);
    const terms = { cycleDay: contract.cycleDay, timezone };
    const today = localDateOf(now, timezone);
    const current = cycleForDate(today, contract.cycleDay).key;
    const open = openCycles(contractTerms(contract), today);
    const next = open.find((c) => c.key > current);
    const payment = await this.paymentsOf(contract, [current, ...(next ? [next.key] : [])]);
    return {
      current: { ...cycleBalance(current, grants, occurrences, terms, now), payment: payment(current) },
      next: next ? { ...cycleBalance(next.key, grants, occurrences, terms, now), payment: payment(next.key) } : null,
      open,
    };
  }

  /** Concessões e reservas do contrato (base do saldo). */
  async ledgerData(db: Tx, contractId: string): Promise<{ grants: BalanceGrant[]; occurrences: BalanceOccurrence[] }> {
    const [grants, occurrences] = await Promise.all([
      db.hourGrant.findMany({ where: { contractId }, select: { cycle: true, kind: true, minutes: true, note: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      db.bookingOccurrence.findMany({
        where: { booking: { contractId }, status: { not: 'cancelled' } },
        select: { id: true, startAt: true, endAt: true, status: true, checkedInAt: true },
        orderBy: { startAt: 'asc' },
      }),
    ]);
    return { grants, occurrences };
  }

  // ───────────── escrita ─────────────

  async create(organizationId: string, residentId: string, input: ContractInput, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const resident = await this.db.resident.findFirst({ where: { id: residentId, organizationId } });
    if (!resident) throw new DomainError('not_found', 'Residente não encontrado');
    const data = await this.validate(organizationId, input);
    const created = await this.db.$transaction(async (tx) => {
      const c = await tx.residentContract.create({ data: { organizationId, residentId, ...data, createdAt: now }, include: contractInclude });
      await audit(tx, organizationId, actor, 'contract.create', 'resident_contract', c.id, { after: c });
      return c;
    });
    await this.ensureGrants(created, org.timezone, now);
    await this.generateIncomes(created, org.timezone, now);
    this.changed(created);
    return created;
  }

  /**
   * Altera os termos. Mudanças valem a partir do próximo ciclo: horas e mensalidade dos ciclos
   * que ainda não começaram seguem os termos novos; o ciclo em andamento só muda por ajuste.
   */
  async update(organizationId: string, id: string, patch: Partial<ContractInput>, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const before = await this.get(organizationId, id);
    const merged: ContractInput = {
      spaceId: before.spaceId,
      monthlyMinutes: before.monthlyMinutes,
      monthlyAmountCents: before.monthlyAmountCents,
      paymentDueDay: before.paymentDueDay,
      cycleDay: before.cycleDay,
      bookingOpensDay: before.bookingOpensDay,
      startsOn: toIsoDate(before.startsOn),
      endsOn: before.endsOn ? toIsoDate(before.endsOn) : null,
      notes: before.notes,
      ...patch,
    };
    const data = await this.validate(organizationId, merged);
    if (data.spaceId !== before.spaceId) {
      const future = await this.db.bookingOccurrence.count({ where: { booking: { contractId: id }, status: { not: 'cancelled' }, startAt: { gt: now } } });
      if (future) throw new DomainError('validation', 'Cancele as reservas futuras antes de trocar a sala do contrato', { code: 'contract_has_bookings' });
    }
    if (data.cycleDay !== before.cycleDay && (await this.db.hourGrant.count({ where: { contractId: id } }))) {
      throw new DomainError('validation', 'O dia de renovação não muda depois que o contrato já tem saldo: encerre e crie outro contrato', { code: 'cycle_day_locked' });
    }
    const today = localDateOf(now, org.timezone);
    const updated = await this.db.$transaction(async (tx) => {
      const c = await tx.residentContract.update({ where: { id }, data, include: contractInclude });
      if (data.monthlyMinutes !== before.monthlyMinutes) {
        // Concessões de ciclos que ainda não começaram seguem os termos novos.
        const grants = await tx.hourGrant.findMany({ where: { contractId: id, kind: 'monthly' } });
        for (const g of grants) {
          if (cycleBounds(g.cycle, before.cycleDay).startsOn > today) await tx.hourGrant.update({ where: { id: g.id }, data: { minutes: data.monthlyMinutes } });
        }
      }
      await audit(tx, organizationId, actor, 'contract.update', 'resident_contract', id, { before, after: c });
      return c;
    });
    await this.ensureGrants(updated, org.timezone, now);
    await this.syncIncomes(updated, org.timezone, now);
    this.changed(updated);
    return updated;
  }

  /** Encerra (hoje ou na data informada): cancela as reservas e mensalidades previstas depois do fim. */
  async end(organizationId: string, id: string, endsOn: IsoDate | null, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const before = await this.get(organizationId, id);
    const today = localDateOf(now, org.timezone);
    const end = endsOn ?? today;
    if (!ISO_DATE.test(end)) throw new DomainError('validation', 'Data de encerramento inválida');
    if (end < toIsoDate(before.startsOn)) throw new DomainError('validation', 'O encerramento não pode ser antes do início do contrato');
    const after = localDayBoundsUtc(end, org.timezone).end;
    const bookingIds: string[] = [];
    const updated = await this.db.$transaction(async (tx) => {
      const c = await tx.residentContract.update({ where: { id }, data: { endsOn: fromIsoDate(end), status: end < today ? 'ended' : 'active' }, include: contractInclude });
      const targets = await tx.bookingOccurrence.findMany({ where: { booking: { contractId: id }, status: { not: 'cancelled' }, startAt: { gte: after } }, select: { id: true, bookingId: true } });
      if (targets.length) {
        await tx.bookingOccurrence.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { status: 'cancelled', cancelledAt: now } });
        await enqueueBookingEmails(tx, targets.map((t) => t.id), 'CANCEL');
        bookingIds.push(...new Set(targets.map((t) => t.bookingId)));
      }
      await audit(tx, organizationId, actor, 'contract.end', 'resident_contract', id, { before: { endsOn: before.endsOn, status: before.status }, after: { endsOn: end, cancelledOccurrences: targets.length } });
      return c;
    });
    await this.syncIncomes(updated, org.timezone, now);
    this.changed(updated);
    if (bookingIds.length) emit(this.events, { organizationId, type: 'booking.changed', spaceId: updated.spaceId, contractId: id, residentId: updated.residentId });
    return updated;
  }

  /** Ajuste do saldo pela equipe (+/−), no ciclo atual ou no próximo já aberto. */
  async adjust(organizationId: string, id: string, input: { minutes: number; note: string; cycle?: string | null }, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const contract = await this.get(organizationId, id);
    if (!Number.isInteger(input.minutes) || input.minutes === 0 || input.minutes % 30 !== 0) {
      throw new DomainError('validation', 'Ajuste em blocos de 30 minutos (positivo ou negativo)');
    }
    const note = input.note?.trim();
    if (!note) throw new DomainError('validation', 'Informe o motivo do ajuste');
    const today = localDateOf(now, org.timezone);
    const current = cycleForDate(today, contract.cycleDay).key;
    const allowed = new Set([current, ...openCycles(contractTerms(contract), today).map((c) => c.key)]);
    const cycle = input.cycle ?? current;
    if (!allowed.has(cycle)) throw new DomainError('validation', 'Só dá para ajustar o ciclo atual ou o próximo já aberto');
    const grant = await this.db.$transaction(async (tx) => {
      const g = await tx.hourGrant.create({ data: { contractId: id, cycle, kind: 'adjustment', minutes: input.minutes, note, actorUserId: actor.userId ?? null } });
      await audit(tx, organizationId, actor, 'contract.adjust_hours', 'resident_contract', id, { after: { cycle, minutes: input.minutes, note } });
      return g;
    });
    emit(this.events, { organizationId, type: 'hours.changed', contractId: id, residentId: contract.residentId });
    return grant;
  }

  async setFile(organizationId: string, id: string, file: { key: string; contentType: string; fileName?: string | null } | null, actor: Actor) {
    const before = await this.get(organizationId, id);
    await this.db.$transaction(async (tx) => {
      await tx.residentContract.update({
        where: { id },
        data: { contractKey: file?.key ?? null, contractContentType: file?.contentType ?? null, contractFileName: file?.fileName ?? null, contractUploadedAt: file ? new Date() : null },
      });
      await audit(tx, organizationId, actor, `contract.file_${file ? 'set' : 'removed'}`, 'resident_contract', id);
    });
    this.changed(before);
    return { previousKey: before.contractKey };
  }

  // ───────────── concessões e mensalidades (job) ─────────────

  /**
   * Concessão mensal dos ciclos abertos (o atual e o próximo depois da virada). Idempotente
   * pelo monthly_key: o job pode rodar quantas vezes for.
   */
  async ensureGrants(contract: ResidentContract, timezone: string, now = new Date(), db: Tx = this.db): Promise<number> {
    if (contract.status !== 'active') return 0;
    const today = localDateOf(now, timezone);
    let cycles = openCycles(contractTerms(contract), today);
    // Com mensalidade, o saldo do ciclo só é liberado depois que a equipe marca o mês como pago.
    if (contract.monthlyAmountCents && cycles.length) {
      const paid = await db.income.findMany({ where: { contractId: contract.id, status: 'received', competence: { in: cycles.map((c) => c.key) } }, select: { competence: true } });
      const paidKeys = new Set(paid.map((i) => i.competence));
      cycles = cycles.filter((c) => paidKeys.has(c.key));
    }
    if (!cycles.length) return 0;
    const { count } = await db.hourGrant.createMany({
      data: cycles.map((c) => ({ contractId: contract.id, cycle: c.key, kind: 'monthly' as const, minutes: contract.monthlyMinutes, monthlyKey: `${contract.id}:${c.key}` })),
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * Situação da mensalidade de cada ciclo (para explicar um saldo zerado): paga, prevista,
   * ou nenhuma (contrato sem mensalidade ou mês sem cobrança).
   */
  async paymentsOf(contract: ResidentContract, keys: string[]) {
    const rows = contract.monthlyAmountCents
      ? await this.db.income.findMany({
          where: { contractId: contract.id, competence: { in: keys }, status: { not: 'cancelled' } },
          select: { id: true, competence: true, status: true, expectedOn: true, amountCents: true },
        })
      : [];
    const byKey = new Map(rows.map((r) => [r.competence!, r]));
    return (key: string): CyclePayment =>
      !contract.monthlyAmountCents
        ? { status: 'not_required' }
        : byKey.get(key)
          ? { status: byKey.get(key)!.status === 'received' ? 'paid' : 'pending', incomeId: byKey.get(key)!.id, dueOn: toIsoDate(byKey.get(key)!.expectedOn), amountCents: byKey.get(key)!.amountCents }
          : { status: 'none' };
  }

  /** Mensalidade prevista do ciclo atual e do próximo, dentro da vigência. Idempotente (contrato, competência). */
  async generateIncomes(contract: ContractWithRelations | (ResidentContract & { resident: { contactId: string }; space: { name: string } }), timezone: string, now = new Date()): Promise<number> {
    if (contract.status !== 'active' || !contract.monthlyAmountCents) return 0;
    const today = localDateOf(now, timezone);
    const current = cycleForDate(today, contract.cycleDay);
    const terms = contractTerms(contract);
    // Nada retroativo: a primeira mensalidade é a que vence a partir do dia em que o contrato foi criado.
    const createdOn = localDateOf(contract.createdAt, timezone);
    const data: Prisma.IncomeCreateManyInput[] = [];
    for (const key of [current.key, shiftCycleKey(current.key, 1)]) {
      const bounds = cycleBounds(key, contract.cycleDay);
      if (bounds.endsOn < terms.startsOn || (terms.endsOn && bounds.startsOn > terms.endsOn)) continue;
      const [y, m] = key.split('-').map(Number) as [number, number];
      const dueOn = dueDateForCompetence(y, m, contract.paymentDueDay ?? contract.cycleDay);
      if (dueOn < createdOn) continue;
      data.push({
        organizationId: contract.organizationId,
        source: 'room_rental',
        description: `Mensalidade ${contract.space.name}`,
        amountCents: contract.monthlyAmountCents,
        expectedOn: fromIsoDate(dueOn),
        contactId: contract.resident.contactId,
        contractId: contract.id,
        competence: key,
      });
    }
    if (!data.length) return 0;
    const { count } = await this.db.income.createMany({ data, skipDuplicates: true });
    if (count) emit(this.events, { organizationId: contract.organizationId, type: 'income.changed', contractId: contract.id, residentId: contract.residentId });
    return count;
  }

  /**
   * Corrige mensalidades geradas antes da regra "sem retroativo" (vencimento anterior à criação do
   * contrato): as ainda previstas são canceladas. Recebidas ficam como estão.
   */
  async cancelRetroactiveIncomes(contract: ResidentContract, timezone: string): Promise<number> {
    const createdOn = localDateOf(contract.createdAt, timezone);
    const { count } = await this.db.income.updateMany({
      where: { contractId: contract.id, status: 'expected', expectedOn: { lt: fromIsoDate(createdOn) } },
      data: { status: 'cancelled' },
    });
    if (count) emit(this.events, { organizationId: contract.organizationId, type: 'income.changed', contractId: contract.id, residentId: contract.residentId });
    return count;
  }

  /** Termos mudaram: ajusta as mensalidades ainda previstas (as recebidas ficam) e gera as que faltam. */
  async syncIncomes(contract: ContractWithRelations, timezone: string, now = new Date()) {
    const today = localDateOf(now, timezone);
    const terms = contractTerms(contract);
    const upcoming = await this.db.income.findMany({ where: { contractId: contract.id, status: 'expected', expectedOn: { gte: fromIsoDate(today) } } });
    for (const inc of upcoming) {
      const bounds = cycleBounds(inc.competence!, contract.cycleDay);
      const outside = !!terms.endsOn && bounds.startsOn > terms.endsOn;
      if (contract.status !== 'active' || !contract.monthlyAmountCents || outside) {
        await this.db.income.update({ where: { id: inc.id }, data: { status: 'cancelled' } });
        continue;
      }
      // Mudança de contrato vale a partir do próximo ciclo: a mensalidade do ciclo em andamento fica.
      if (bounds.startsOn <= today) continue;
      const [y, m] = inc.competence!.split('-').map(Number) as [number, number];
      await this.db.income.update({
        where: { id: inc.id },
        data: {
          amountCents: contract.monthlyAmountCents,
          expectedOn: fromIsoDate(dueDateForCompetence(y, m, contract.paymentDueDay ?? contract.cycleDay)),
          description: `Mensalidade ${contract.space.name}`,
        },
      });
    }
    await this.generateIncomes(contract, timezone, now);
  }

  /** Job: concessões e mensalidades de todos os contratos ativos; encerra os que já passaram do fim. */
  async runMaintenance(now = new Date()) {
    const contracts = await this.db.residentContract.findMany({ where: { status: 'active' }, include: { ...contractInclude, organization: { select: { timezone: true } } } });
    let grants = 0;
    let incomes = 0;
    let ended = 0;
    for (const c of contracts) {
      const tz = c.organization.timezone;
      const today = localDateOf(now, tz);
      if (c.endsOn && toIsoDate(c.endsOn) < today) {
        await this.db.residentContract.update({ where: { id: c.id }, data: { status: 'ended' } });
        ended++;
        this.changed(c);
        continue;
      }
      const g = await this.ensureGrants(c, tz, now);
      if (g) emit(this.events, { organizationId: c.organizationId, type: 'hours.changed', contractId: c.id, residentId: c.residentId });
      grants += g;
      await this.cancelRetroactiveIncomes(c, tz);
      incomes += await this.generateIncomes(c, tz, now);
    }
    return { contracts: contracts.length, grants, incomes, ended };
  }

  // ───────────── internos ─────────────

  private changed(c: { organizationId: string; id: string; residentId: string; spaceId: string }) {
    emit(this.events, { organizationId: c.organizationId, type: 'contract.changed', contractId: c.id, residentId: c.residentId, spaceId: c.spaceId });
  }

  private async validate(organizationId: string, input: ContractInput) {
    const space = await this.db.space.findFirst({ where: { id: input.spaceId, organizationId, active: true } });
    if (!space) throw new DomainError('not_found', 'Sala não encontrada');
    if (space.status === 'monthly_rental') throw new DomainError('validation', `A ${space.name} está alugada mensalmente e não recebe reservas`, { code: 'space_rented' });
    if (!Number.isInteger(input.monthlyMinutes) || input.monthlyMinutes <= 0 || input.monthlyMinutes % 30 !== 0) {
      throw new DomainError('validation', 'Horas por mês em blocos de 30 minutos');
    }
    if (input.monthlyMinutes > 31 * 24 * 60) throw new DomainError('validation', 'Horas por mês acima do possível');
    if (input.monthlyAmountCents != null && (!Number.isInteger(input.monthlyAmountCents) || input.monthlyAmountCents <= 0)) {
      throw new DomainError('validation', 'Valor da mensalidade inválido');
    }
    day(input.cycleDay, 'dia de renovação do saldo');
    day(input.bookingOpensDay, 'dia de virada da agenda');
    day(input.paymentDueDay, 'dia de vencimento', false);
    if (!ISO_DATE.test(input.startsOn)) throw new DomainError('validation', 'Informe o início do contrato');
    if (input.endsOn && (!ISO_DATE.test(input.endsOn) || input.endsOn < input.startsOn)) throw new DomainError('validation', 'O fim do contrato deve ser depois do início');
    return {
      spaceId: space.id,
      monthlyMinutes: input.monthlyMinutes,
      monthlyAmountCents: input.monthlyAmountCents ?? null,
      paymentDueDay: input.paymentDueDay ?? null,
      cycleDay: input.cycleDay,
      bookingOpensDay: input.bookingOpensDay,
      startsOn: fromIsoDate(input.startsOn),
      endsOn: input.endsOn ? fromIsoDate(input.endsOn) : null,
      notes: input.notes?.trim() || null,
    };
  }
}
