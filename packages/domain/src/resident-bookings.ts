import type { Prisma } from '@coxia/database';
import { addDays, type IsoDate, localDateOf, localDayBoundsUtc, openCycles, type OpenCycle } from '@coxia/shared';
import { DateTime } from 'luxon';
import { type Interval, openIntervals, subtractIntervals } from './availability';
import type { BookingService } from './bookings';
import {
  type Actor,
  audit,
  type Db,
  type DomainEventPublisher,
  DomainError,
  emit,
  getOrganization,
  NO_EVENTS,
  type Tx,
} from './common';
import { attendanceOf, canAfford, cycleBalance, cycleKeyOfInstant, durationMinutes, formatMinutes } from './hour-balance';
import { contractInclude, contractTerms, isContractLive, type ResidentContractService } from './resident-contracts';

/** Reservas em blocos de 30 min, com pelo menos 1 h. */
export const BOOKING_STEP_MINUTES = 30;
export const MIN_BOOKING_MINUTES = 60;
/** Check-in abre 15 min antes do início e vai até o fim da reserva. */
export const CHECK_IN_EARLY_MINUTES = 15;

export interface ResidentBookingInput {
  contractId: string;
  startAt: Date;
  endAt: Date;
  /** Repete toda semana, no mesmo dia e horário, até o fim do ciclo. */
  repeatWeekly?: boolean;
  onConflict?: 'fail' | 'skip';
  /** Nome e descrição internos (só o residente vê). */
  label?: string | null;
  notes?: string | null;
}

const LABEL_MAX = 80;
const NOTES_MAX = 1000;

function cleanLabel(input: { label?: string | null; notes?: string | null }) {
  const label = input.label?.trim() || null;
  const notes = input.notes?.trim() || null;
  if (label && label.length > LABEL_MAX) throw new DomainError('validation', `Nome com até ${LABEL_MAX} caracteres`);
  if (notes && notes.length > NOTES_MAX) throw new DomainError('validation', `Descrição com até ${NOTES_MAX} caracteres`);
  return { label, notes };
}

export type RoomCheckInState =
  | { state: 'no_contract' }
  | { state: 'checked_in'; occurrence: ResidentOccurrence }
  | { state: 'booking'; occurrence: ResidentOccurrence }
  | { state: 'occupied'; until: Date }
  | { state: 'walk_in'; contractId: string; startAt: Date; maxMinutes: number; availableMinutes: number }
  | { state: 'unavailable'; reason: 'closed' | 'no_balance' | 'too_short' | 'contract_closed'; availableMinutes?: number };

const occurrenceSelect = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  checkedInAt: true,
  checkInMethod: true,
  bookingId: true,
  spaceId: true,
  booking: { select: { id: true, contractId: true, recurrenceRule: true, groupId: true, seriesUntil: true, residentLabel: true, residentNotes: true } },
  space: { select: { id: true, name: true, color: true, icon: true } },
} satisfies Prisma.BookingOccurrenceSelect;

type OccurrenceRow = Prisma.BookingOccurrenceGetPayload<{ select: typeof occurrenceSelect }>;
export type ResidentOccurrence = ReturnType<typeof present>;

function present(o: OccurrenceRow, now: Date, checkInEnabled = true) {
  const opensAt = new Date(o.startAt.getTime() - CHECK_IN_EARLY_MINUTES * 60_000);
  const attendance = o.status === 'cancelled' ? null : attendanceOf(o, now);
  return {
    id: o.id,
    bookingId: o.bookingId,
    contractId: o.booking.contractId,
    startAt: o.startAt,
    endAt: o.endAt,
    status: o.status,
    minutes: durationMinutes(o),
    checkedInAt: o.checkedInAt,
    checkInMethod: o.checkInMethod,
    attendance,
    /** Faz parte de uma série semanal. */
    recurring: !!o.booking.recurrenceRule,
    label: o.booking.residentLabel,
    notes: o.booking.residentNotes,
    space: o.space,
    canCheckIn: checkInEnabled && o.status !== 'cancelled' && !o.checkedInAt && opensAt <= now && now < o.endAt,
    canCancel: o.status !== 'cancelled' && !o.checkedInAt && now < o.startAt,
  };
}

const minuteOfDay = (d: Date, tz: string) => {
  const dt = DateTime.fromJSDate(d, { zone: tz });
  return dt.hour * 60 + dt.minute + dt.second / 60 + dt.millisecond / 60000;
};

/**
 * Reservas feitas pelo próprio residente, consumindo as horas do contrato.
 * Conflito de horário (entre residentes ou com reservas da equipe) é regra do BookingService
 * e da constraint EXCLUDE do banco; aqui ficam as regras de contrato e saldo.
 */
export class ResidentBookingService {
  constructor(
    private readonly db: Db,
    private readonly bookings: BookingService,
    private readonly contracts: ResidentContractService,
    private readonly events: DomainEventPublisher = NO_EVENTS,
    /** Check-in desligado: ninguém faz check-in e as horas saem no horário da reserva. */
    private readonly opts: { checkInEnabled?: boolean } = {},
  ) {}

  get checkInEnabled() {
    return this.opts.checkInEnabled ?? true;
  }

  private assertCheckInEnabled() {
    if (!this.checkInEnabled) throw new DomainError('not_found', 'O check-in está desativado', { code: 'check_in_disabled' });
  }

  // ───────────── contrato ─────────────

  /** Contrato do residente (nunca de outro). */
  async ownContract(organizationId: string, residentId: string, contractId: string) {
    const c = await this.db.residentContract.findFirst({ where: { id: contractId, organizationId, residentId }, include: contractInclude });
    if (!c) throw new DomainError('not_found', 'Contrato não encontrado');
    return c;
  }

  /** Horários da sala do contrato: funcionamento, ocupados (sem dizer por quem) e os meus. */
  async availability(organizationId: string, residentId: string, contractId: string, from: IsoDate, until: IsoDate, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const tz = org.timezone;
    const contract = await this.ownContract(organizationId, residentId, contractId);
    if (until < from) throw new DomainError('validation', 'Período inválido');
    if (addDays(from, 62) < until) throw new DomainError('validation', 'Consulte no máximo 2 meses por vez');
    const space = await this.db.space.findUniqueOrThrow({ where: { id: contract.spaceId }, include: { availabilityRules: true } });
    const start = localDayBoundsUtc(from, tz).start;
    const end = localDayBoundsUtc(until, tz).end;
    const [occs, blocks] = await Promise.all([
      this.db.bookingOccurrence.findMany({
        where: { spaceId: contract.spaceId, status: { not: 'cancelled' }, startAt: { lt: end }, endAt: { gt: start } },
        select: { id: true, startAt: true, endAt: true, booking: { select: { contractId: true, residentLabel: true, contract: { select: { residentId: true } } } } },
        orderBy: { startAt: 'asc' },
      }),
      this.db.spaceBlock.findMany({ where: { spaceId: contract.spaceId, startAt: { lt: end }, endAt: { gt: start } } }),
    ]);
    const days: Array<{ date: IsoDate; open: Interval[]; free: Interval[] }> = [];
    for (let d = from; d <= until; d = addDays(d, 1)) {
      const open = openIntervals(space.availabilityRules, d, tz);
      const busy = [...occs.map((o) => ({ start: o.startAt, end: o.endAt })), ...blocks.map((b) => ({ start: b.startAt, end: b.endAt }))];
      days.push({ date: d, open, free: subtractIntervals(open, busy, BOOKING_STEP_MINUTES) });
    }
    const terms = contractTerms(contract);
    return {
      space: { id: space.id, name: space.name, color: space.color, icon: space.icon },
      openCycles: openCycles(terms, localDateOf(now, tz)),
      days,
      busy: [
        ...occs.map((o) => {
          const mine = o.booking.contract?.residentId === residentId;
          // De outra pessoa: só o horário ocupado, sem nome.
          return { startAt: o.startAt, endAt: o.endAt, mine, occurrenceId: mine ? o.id : null, label: mine ? o.booking.residentLabel : null };
        }),
        ...blocks.map((b) => ({ startAt: b.startAt, endAt: b.endAt, mine: false, occurrenceId: null, label: null })),
      ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    };
  }

  // ───────────── reservas ─────────────

  async list(organizationId: string, residentId: string, from: Date, to: Date, now = new Date(), opts: { includeCancelled?: boolean } = {}) {
    const rows = await this.db.bookingOccurrence.findMany({
      where: {
        organizationId,
        booking: { contract: { residentId } },
        ...(opts.includeCancelled ? {} : { status: { not: 'cancelled' } }),
        startAt: { lt: to },
        endAt: { gt: from },
      },
      select: occurrenceSelect,
      orderBy: { startAt: 'asc' },
    });
    return rows.map((o) => present(o, now, this.checkInEnabled));
  }

  async getOwn(organizationId: string, residentId: string, occurrenceId: string, now = new Date()) {
    const o = await this.db.bookingOccurrence.findFirst({
      where: { id: occurrenceId, organizationId, booking: { contract: { residentId } } },
      select: occurrenceSelect,
    });
    if (!o) throw new DomainError('not_found', 'Reserva não encontrada');
    return present(o, now, this.checkInEnabled);
  }

  /**
   * Nova reserva (avulsa ou semanal até o fim do ciclo). Regras: sala do contrato, blocos de 30 min,
   * no mínimo 1 h, no futuro, dentro de um ciclo aberto e com saldo no ciclo em que cada data cai.
   */
  async book(organizationId: string, residentId: string, input: ResidentBookingInput, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const tz = org.timezone;
    const contract = await this.ownContract(organizationId, residentId, input.contractId);
    const today = localDateOf(now, tz);
    if (!isContractLive(contract, today)) throw new DomainError('validation', 'Este contrato não está mais vigente', { code: 'contract_closed' });
    this.assertSlot(input.startAt, input.endAt, tz);
    if (input.startAt < now) throw new DomainError('validation', 'Escolha um horário a partir de agora');
    const date = localDateOf(input.startAt, tz);
    const cycle = this.openCycleFor(contractTerms(contract), today, date);
    const extra = cleanLabel(input);
    await this.contracts.ensureGrants(contract, tz, now);

    const hhmm = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat('HH:mm');
    const weekly = input.repeatWeekly
      ? { startsOn: date, until: cycle.bookableUntil, slots: [{ weekday: DateTime.fromJSDate(input.startAt, { zone: tz }).weekday, start: hhmm(input.startAt), end: hhmm(input.endAt) }] }
      : null;

    const result = await this.bookings.create(
      organizationId,
      {
        spaceId: contract.spaceId,
        ...(weekly ? { weekly } : { startAt: input.startAt, endAt: input.endAt }),
        title: contract.resident.name,
        contactId: contract.resident.contactId,
        hourlyRateCents: null,
        periodRateCents: null,
        contractId: contract.id,
        source: 'resident',
        residentLabel: extra.label,
        residentNotes: extra.notes,
        onConflict: input.onConflict ?? 'fail',
        beforeInsert: (tx, intervals) => this.assertBalance(tx, contract.id, contract.cycleDay, tz, intervals, now),
      },
      actor,
      now,
    );
    return { ...result, occurrences: result.occurrences.map((o) => ({ id: o.id, startAt: o.startAt, endAt: o.endAt })) };
  }

  /** Renomeia a própria reserva (vale para a série inteira). */
  async updateLabel(organizationId: string, residentId: string, bookingId: string, input: { label?: string | null; notes?: string | null }, actor: Actor) {
    const booking = await this.db.booking.findFirst({ where: { id: bookingId, organizationId, contract: { residentId } }, select: { id: true, groupId: true, spaceId: true, contractId: true } });
    if (!booking) throw new DomainError('not_found', 'Reserva não encontrada');
    const { label, notes } = cleanLabel(input);
    const ids = booking.groupId
      ? (await this.db.booking.findMany({ where: { organizationId, groupId: booking.groupId, contract: { residentId } }, select: { id: true } })).map((b) => b.id)
      : [booking.id];
    await this.db.$transaction(async (tx) => {
      await tx.booking.updateMany({ where: { id: { in: ids } }, data: { residentLabel: label, residentNotes: notes } });
      await audit(tx, organizationId, actor, 'booking.resident_label', 'booking', booking.id, { after: { label, notes, bookings: ids } });
    });
    emit(this.events, { organizationId, type: 'booking.changed', spaceId: booking.spaceId, contractId: booking.contractId, residentId });
    return { label, notes };
  }

  async cancelOccurrence(organizationId: string, residentId: string, occurrenceId: string, actor: Actor, now = new Date()) {
    const occ = await this.getOwn(organizationId, residentId, occurrenceId, now);
    if (occ.status === 'cancelled') return occ;
    if (!occ.canCancel) {
      throw new DomainError('validation', occ.checkedInAt ? 'Reserva com check-in feito não pode ser cancelada' : 'Só dá para cancelar antes do início da reserva', { code: 'cannot_cancel' });
    }
    await this.bookings.cancelOccurrence(organizationId, occurrenceId, actor);
    return this.getOwn(organizationId, residentId, occurrenceId, now);
  }

  /** Cancela esta e as próximas da série (as horas voltam). Nada que já começou é cancelado. */
  async cancelSeries(organizationId: string, residentId: string, bookingId: string, fromDate: IsoDate, actor: Actor, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const booking = await this.db.booking.findFirst({ where: { id: bookingId, organizationId, contract: { residentId } } });
    if (!booking?.recurrenceRule) throw new DomainError('not_found', 'Série não encontrada');
    const from = localDayBoundsUtc(fromDate, org.timezone).start;
    const started = await this.db.bookingOccurrence.count({
      where: { bookingId, status: { not: 'cancelled' }, startAt: { gte: from }, OR: [{ startAt: { lte: now } }, { checkedInAt: { not: null } }] },
    });
    if (started) throw new DomainError('validation', 'A reserva de hoje já começou: cancele a partir da próxima data', { code: 'cannot_cancel' });
    return this.bookings.cancelSeries(organizationId, bookingId, fromDate, actor, { wholeGroup: true });
  }

  // ───────────── check-in ─────────────

  /**
   * Check-in de 15 min antes do início até o fim. Só registra a presença: as horas da reserva
   * inteira já saíram do saldo ao reservar (check-in atrasado não muda o débito).
   * `residentId` null = equipe registrando pelo painel.
   */
  async checkIn(organizationId: string, residentId: string | null, occurrenceId: string, method: 'email_link' | 'room_qr' | 'staff', actor: Actor, now = new Date()) {
    this.assertCheckInEnabled();
    const o = await this.db.bookingOccurrence.findFirst({
      where: { id: occurrenceId, organizationId, booking: residentId ? { contract: { residentId } } : { contractId: { not: null } } },
      select: { ...occurrenceSelect, booking: { select: { ...occurrenceSelect.booking.select, contract: { select: { residentId: true } } } } },
    });
    if (!o) throw new DomainError('not_found', 'Reserva não encontrada');
    if (o.checkedInAt) return present(o, now);
    if (o.status === 'cancelled') throw new DomainError('validation', 'Esta reserva foi cancelada', { code: 'cancelled' });
    const opensAt = new Date(o.startAt.getTime() - CHECK_IN_EARLY_MINUTES * 60_000);
    if (now < opensAt) throw new DomainError('validation', `O check-in abre ${CHECK_IN_EARLY_MINUTES} minutos antes do início da reserva`, { code: 'too_early', opensAt });
    if (now >= o.endAt) throw new DomainError('validation', 'O horário desta reserva já terminou', { code: 'too_late' });
    const updated = await this.db.$transaction(async (tx) => {
      const { count } = await tx.bookingOccurrence.updateMany({ where: { id: o.id, checkedInAt: null }, data: { checkedInAt: now, checkInMethod: method } });
      if (count) await audit(tx, organizationId, actor, 'booking.check_in', 'booking_occurrence', o.id, { after: { method, at: now } });
      return tx.bookingOccurrence.findUniqueOrThrow({ where: { id: o.id }, select: occurrenceSelect });
    });
    emit(this.events, { organizationId, type: 'booking.changed', spaceId: o.spaceId, contractId: o.booking.contractId, residentId: o.booking.contract?.residentId ?? null });
    return present(updated, now);
  }

  /** QR code da sala: o que fazer agora (check-in da reserva, uso avulso, ou sala ocupada). */
  async roomStatus(organizationId: string, residentId: string, spaceId: string, now = new Date()): Promise<RoomCheckInState> {
    this.assertCheckInEnabled();
    const org = await getOrganization(this.db, organizationId);
    const tz = org.timezone;
    const today = localDateOf(now, tz);
    const contracts = (await this.db.residentContract.findMany({ where: { organizationId, residentId, spaceId }, include: contractInclude })).filter((c) => isContractLive(c, today));
    if (!contracts.length) return { state: 'no_contract' };

    const windowStart = new Date(now.getTime() + CHECK_IN_EARLY_MINUTES * 60_000);
    const mine = await this.db.bookingOccurrence.findFirst({
      where: { spaceId, status: { not: 'cancelled' }, booking: { contract: { residentId } }, startAt: { lte: windowStart }, endAt: { gt: now } },
      select: occurrenceSelect,
      orderBy: { startAt: 'asc' },
    });
    if (mine) return mine.checkedInAt ? { state: 'checked_in', occurrence: present(mine, now) } : { state: 'booking', occurrence: present(mine, now) };

    const current = await this.db.bookingOccurrence.findFirst({ where: { spaceId, status: { not: 'cancelled' }, startAt: { lte: now }, endAt: { gt: now } }, orderBy: { endAt: 'desc' } });
    if (current) return { state: 'occupied', until: current.endAt };

    const contract = contracts.find((c) => openCycles(contractTerms(c), today).some((oc) => oc.bookableFrom <= today && today <= oc.bookableUntil));
    if (!contract) return { state: 'unavailable', reason: 'contract_closed' };
    await this.contracts.ensureGrants(contract, tz, now);
    const { grants, occurrences } = await this.contracts.ledgerData(this.db, contract.id);
    const cycleKey = cycleKeyOfInstant(now, { cycleDay: contract.cycleDay, timezone: tz });
    const available = cycleBalance(cycleKey, grants, occurrences, { cycleDay: contract.cycleDay, timezone: tz }, now).availableMinutes;

    const startAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const space = await this.db.space.findUniqueOrThrow({ where: { id: spaceId }, include: { availabilityRules: true } });
    const openNow = openIntervals(space.availabilityRules, today, tz).find((i) => i.start <= startAt && startAt < i.end);
    if (!openNow) return { state: 'unavailable', reason: 'closed' };
    const [next, block] = await Promise.all([
      this.db.bookingOccurrence.findFirst({ where: { spaceId, status: { not: 'cancelled' }, startAt: { gte: startAt } }, orderBy: { startAt: 'asc' } }),
      this.db.spaceBlock.findFirst({ where: { spaceId, endAt: { gt: startAt } }, orderBy: { startAt: 'asc' } }),
    ]);
    const endOfDay = localDayBoundsUtc(today, tz).end;
    const limit = Math.min(openNow.end.getTime(), next?.startAt.getTime() ?? Infinity, block ? Math.max(block.startAt.getTime(), startAt.getTime()) : Infinity, endOfDay.getTime());
    const fits = Math.floor((limit - startAt.getTime()) / 60_000);
    const maxMinutes = Math.floor(Math.min(fits, available) / BOOKING_STEP_MINUTES) * BOOKING_STEP_MINUTES;
    if (available < MIN_BOOKING_MINUTES) return { state: 'unavailable', reason: 'no_balance', availableMinutes: Math.max(0, available) };
    if (maxMinutes < MIN_BOOKING_MINUTES) return { state: 'unavailable', reason: 'too_short', availableMinutes: available };
    return { state: 'walk_in', contractId: contract.id, startAt, maxMinutes, availableMinutes: available };
  }

  /** Uso avulso pelo QR: cria a reserva começando agora e já faz o check-in. */
  async walkIn(organizationId: string, residentId: string, spaceId: string, durationMinutes: number, actor: Actor, now = new Date()) {
    this.assertCheckInEnabled();
    const status = await this.roomStatus(organizationId, residentId, spaceId, now);
    if (status.state !== 'walk_in') throw new DomainError('validation', 'Não dá para usar a sala agora', { code: 'walk_in_unavailable', status });
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_BOOKING_MINUTES || durationMinutes % BOOKING_STEP_MINUTES !== 0) {
      throw new DomainError('validation', 'Duração em blocos de 30 minutos, com pelo menos 1 hora');
    }
    if (durationMinutes > status.maxMinutes) throw new DomainError('validation', `Dá para usar no máximo ${formatMinutes(status.maxMinutes)} agora`, { code: 'too_long', maxMinutes: status.maxMinutes });
    const org = await getOrganization(this.db, organizationId);
    const contract = await this.ownContract(organizationId, residentId, status.contractId);
    const endAt = new Date(status.startAt.getTime() + durationMinutes * 60_000);
    const result = await this.bookings.create(
      organizationId,
      {
        spaceId,
        startAt: status.startAt,
        endAt,
        title: contract.resident.name,
        contactId: contract.resident.contactId,
        hourlyRateCents: null,
        periodRateCents: null,
        contractId: contract.id,
        source: 'resident',
        sendInvites: false,
        beforeInsert: (tx, intervals) => this.assertBalance(tx, contract.id, contract.cycleDay, org.timezone, intervals, now),
      },
      actor,
      now,
    );
    return this.checkIn(organizationId, residentId, result.occurrences[0]!.id, 'room_qr', actor, now);
  }

  // ───────────── regras ─────────────

  /** Trava o contrato (reservas simultâneas do mesmo residente esperam a vez) e confere o saldo. */
  private async assertBalance(tx: Tx, contractId: string, cycleDay: number, timezone: string, intervals: Interval[], now: Date) {
    await tx.$queryRaw`SELECT id FROM "resident_contracts" WHERE id = ${contractId} FOR UPDATE`;
    const { grants, occurrences } = await this.contracts.ledgerData(tx, contractId);
    const res = canAfford(intervals, grants, occurrences, { cycleDay, timezone }, now);
    if (!res.ok) {
      const s = res.shortfalls[0]!;
      throw new DomainError('validation', `Saldo insuficiente: a reserva precisa de ${formatMinutes(s.neededMinutes)} e o ciclo tem ${formatMinutes(s.availableMinutes)} disponíveis`, {
        code: 'insufficient_hours',
        shortfalls: res.shortfalls,
      });
    }
  }

  private assertSlot(startAt: Date, endAt: Date, tz: string) {
    if (!(startAt < endAt)) throw new DomainError('validation', 'O fim deve ser depois do início');
    const aligned = (d: Date) => d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 && minuteOfDay(d, tz) % BOOKING_STEP_MINUTES === 0;
    if (!aligned(startAt) || !aligned(endAt)) throw new DomainError('validation', 'Reservas começam e terminam em horas cheias ou meias (ex.: 14:00, 14:30)');
    const minutes = durationMinutes({ startAt, endAt });
    if (minutes < MIN_BOOKING_MINUTES) throw new DomainError('validation', 'A reserva precisa ter pelo menos 1 hora');
    const sameDay = localDateOf(startAt, tz) === localDateOf(new Date(endAt.getTime() - 1), tz);
    if (!sameDay) throw new DomainError('validation', 'A reserva precisa começar e terminar no mesmo dia');
  }

  private openCycleFor(terms: ReturnType<typeof contractTerms>, today: IsoDate, date: IsoDate): OpenCycle {
    const cycles = openCycles(terms, today);
    const cycle = cycles.find((c) => c.bookableFrom <= date && date <= c.bookableUntil);
    if (cycle) return cycle;
    const last = cycles[cycles.length - 1];
    throw new DomainError('validation', last ? `A agenda está aberta até ${last.bookableUntil.split('-').reverse().join('/')}` : 'A agenda deste contrato ainda não abriu', {
      code: 'cycle_closed',
      openCycles: cycles,
    });
  }
}
