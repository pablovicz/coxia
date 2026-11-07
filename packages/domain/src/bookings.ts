import { isBookingOverlapError, type Prisma } from '@coxia/database';
import {
  addDays,
  assertValidInterval,
  expandDates,
  formatRRule,
  type IsoDate,
  localDateOf,
  localDayBoundsUtc,
  parseRRule,
  zonedToUtc,
} from '@coxia/shared';
import { DateTime } from 'luxon';
import {
  clipIntervals,
  type Interval,
  type OpeningRule,
  openIntervals,
  subtractIntervals,
  withinOperatingHours,
} from './availability';
import { type Actor, audit, type Db, DomainError, fromIsoDate, getOrganization, toIsoDate, type Tx } from './common';

/** Quanto à frente as ocorrências de séries sem fim ficam materializadas. */
export const SERIES_HORIZON_DAYS = 182;

export type ConflictReason = 'overlap' | 'blocked' | 'outside_hours';

export interface Conflict {
  startAt: Date;
  endAt: Date;
  reason: ConflictReason;
  /** Reserva com que conflita (quando reason = overlap). */
  with?: { occurrenceId: string; bookingId: string; title: string | null; responsibleName: string | null; startAt: Date; endAt: Date };
  /** Bloqueio com que conflita (quando reason = blocked). */
  block?: { id: string; reason: string | null };
}

export interface CreateBookingInput {
  spaceId: string;
  startAt: Date;
  endAt: Date;
  title?: string | null;
  responsibleName?: string | null;
  responsiblePhone?: string | null;
  notes?: string | null;
  status?: 'confirmed' | 'tentative';
  /** RRULE semanal/mensal em datas locais; a primeira ocorrência é startAt/endAt. */
  recurrence?: { rule: string; until?: IsoDate | null } | null;
  notifyOneHourBefore?: boolean;
  /** "fail": qualquer conflito rejeita tudo; "skip": cria o que couber e relata o resto. */
  onConflict?: 'fail' | 'skip';
}

const hhmm = (instant: Date, timezone: string) => DateTime.fromJSDate(instant, { zone: timezone }).toFormat('HH:mm');

const occurrenceInclude = {
  booking: { select: { id: true, title: true, responsibleName: true, responsiblePhone: true, notes: true, recurrenceRule: true, status: true } },
  space: { select: { id: true, name: true } },
} satisfies Prisma.BookingOccurrenceInclude;

export type OccurrenceWithBooking = Prisma.BookingOccurrenceGetPayload<{ include: typeof occurrenceInclude }>;

export class BookingService {
  constructor(private readonly db: Db) {}

  // ───────────── consultas ─────────────

  listOccurrences(organizationId: string, from: Date, to: Date, opts: { spaceId?: string; includeCancelled?: boolean } = {}) {
    return this.db.bookingOccurrence.findMany({
      where: {
        organizationId,
        ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
        ...(opts.includeCancelled ? {} : { status: { not: 'cancelled' } }),
        startAt: { lt: to },
        endAt: { gt: from },
      },
      include: occurrenceInclude,
      orderBy: [{ startAt: 'asc' }, { space: { sortOrder: 'asc' } }],
    });
  }

  async getOccurrence(organizationId: string, occurrenceId: string) {
    const occ = await this.db.bookingOccurrence.findFirst({ where: { id: occurrenceId, organizationId }, include: occurrenceInclude });
    if (!occ) throw new DomainError('not_found', 'Reserva não encontrada');
    return occ;
  }

  /** Horários livres por sala num dia local, opcionalmente recortados a uma janela. */
  async availability(organizationId: string, date: IsoDate, opts: { spaceId?: string; window?: Interval } = {}) {
    const org = await getOrganization(this.db, organizationId);
    const day = localDayBoundsUtc(date, org.timezone);
    const spaces = await this.db.space.findMany({
      where: { organizationId, active: true, ...(opts.spaceId ? { id: opts.spaceId } : {}) },
      include: { availabilityRules: true },
      orderBy: { sortOrder: 'asc' },
    });
    const [occurrences, blocks] = await Promise.all([
      this.listOccurrences(organizationId, day.start, day.end),
      this.db.spaceBlock.findMany({ where: { organizationId, startAt: { lt: day.end }, endAt: { gt: day.start } } }),
    ]);
    return spaces.map((space) => {
      const busy = [
        ...occurrences.filter((o) => o.spaceId === space.id).map((o) => ({ start: o.startAt, end: o.endAt })),
        ...blocks.filter((b) => b.spaceId === space.id).map((b) => ({ start: b.startAt, end: b.endAt })),
      ];
      let free = subtractIntervals(openIntervals(space.availabilityRules, date, org.timezone), busy);
      if (opts.window) free = clipIntervals(free, opts.window);
      return {
        space: { id: space.id, name: space.name },
        free,
        occurrences: occurrences.filter((o) => o.spaceId === space.id),
      };
    });
  }

  /**
   * Reservas candidatas para "cancela a reserva das 15h de amanhã": no mesmo dia local,
   * contendo o horário ou começando até 30 min dele.
   */
  async findAround(organizationId: string, around: Date, spaceId?: string | null) {
    const org = await getOrganization(this.db, organizationId);
    const day = localDayBoundsUtc(localDateOf(around, org.timezone), org.timezone);
    const sameDay = await this.listOccurrences(organizationId, day.start, day.end, { spaceId: spaceId ?? undefined });
    return sameDay.filter(
      (o) => (o.startAt <= around && around < o.endAt) || Math.abs(o.startAt.getTime() - around.getTime()) <= 30 * 60_000,
    );
  }

  // ───────────── criação ─────────────

  async create(organizationId: string, input: CreateBookingInput, actor: Actor, now = new Date()) {
    assertInterval(input.startAt, input.endAt);
    const org = await getOrganization(this.db, organizationId);
    const tz = org.timezone;
    const space = await this.db.space.findFirst({
      where: { id: input.spaceId, organizationId, active: true },
      include: { availabilityRules: true },
    });
    if (!space) throw new DomainError('not_found', 'Sala não encontrada');

    let intervals: Interval[] = [{ start: input.startAt, end: input.endAt }];
    let series: { rule: string; startsOn: IsoDate; localStart: string; localEnd: string; until: IsoDate | null; horizon: IsoDate } | null = null;

    if (input.recurrence) {
      const startsOn = localDateOf(input.startAt, tz);
      if (localDateOf(input.endAt, tz) !== startsOn) {
        throw new DomainError('validation', 'Reservas recorrentes precisam começar e terminar no mesmo dia');
      }
      let rule;
      try {
        rule = parseRRule(input.recurrence.rule);
      } catch (e) {
        throw new DomainError('validation', `Recorrência inválida: ${(e as Error).message}`);
      }
      const until = input.recurrence.until ?? rule.until;
      const horizonLimit = addDays(localDateOf(now, tz), SERIES_HORIZON_DAYS);
      const horizon = until && until < horizonLimit ? until : horizonLimit;
      const localStart = hhmm(input.startAt, tz);
      const localEnd = hhmm(input.endAt, tz);
      intervals = expandDates({ ...rule, until }, startsOn, startsOn, horizon).map((date) => ({
        start: zonedToUtc(date, localStart, tz),
        end: zonedToUtc(date, localEnd, tz),
      }));
      if (intervals.length === 0) throw new DomainError('validation', 'A recorrência não gera nenhuma data');
      series = { rule: formatRRule({ ...rule, until: null }), startsOn, localStart, localEnd, until, horizon };
    }

    const conflicts = await this.findConflicts(this.db, space.id, space.availabilityRules, intervals, tz);
    const conflictStarts = new Set(conflicts.map((c) => c.startAt.getTime()));
    const toCreate = intervals.filter((i) => !conflictStarts.has(i.start.getTime()));

    if (conflicts.length > 0 && (input.onConflict ?? 'fail') === 'fail') {
      throw new DomainError('conflict', conflictMessage(conflicts), { conflicts });
    }
    if (toCreate.length === 0) throw new DomainError('conflict', conflictMessage(conflicts), { conflicts });

    try {
      return await this.db.$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            organizationId,
            spaceId: space.id,
            title: input.title?.trim() || null,
            responsibleName: input.responsibleName?.trim() || null,
            responsiblePhone: input.responsiblePhone ?? null,
            notes: input.notes?.trim() || null,
            status: input.status ?? 'confirmed',
            notifyOneHourBefore: input.notifyOneHourBefore ?? false,
            createdByPhone: actor.phone ?? null,
            sourceMessageId: actor.sourceMessageId ?? null,
            ...(series
              ? {
                  recurrenceRule: series.rule,
                  seriesStartsOn: fromIsoDate(series.startsOn),
                  seriesUntil: series.until ? fromIsoDate(series.until) : null,
                  localStartTime: series.localStart,
                  localEndTime: series.localEnd,
                  materializedUntil: fromIsoDate(series.horizon),
                }
              : {}),
          },
        });
        await tx.bookingOccurrence.createMany({
          data: toCreate.map((i) => ({
            organizationId,
            bookingId: booking.id,
            spaceId: space.id,
            startAt: i.start,
            endAt: i.end,
            status: booking.status,
          })),
        });
        const occurrences = await tx.bookingOccurrence.findMany({
          where: { bookingId: booking.id },
          include: occurrenceInclude,
          orderBy: { startAt: 'asc' },
        });
        await audit(tx, organizationId, actor, 'booking.create', 'booking', booking.id, {
          after: { booking, occurrences: occurrences.length, skipped: conflicts.length },
        });
        return { booking, occurrences, skipped: conflicts };
      });
    } catch (err) {
      // Outra reserva entrou entre a checagem e o insert: o banco garante a regra.
      if (isBookingOverlapError(err)) {
        throw new DomainError('conflict', 'O horário acabou de ser reservado por outra pessoa. Consulte a agenda novamente.');
      }
      throw err;
    }
  }

  // ───────────── cancelamento ─────────────

  async cancelOccurrence(organizationId: string, occurrenceId: string, actor: Actor) {
    const occ = await this.getOccurrence(organizationId, occurrenceId);
    if (occ.status === 'cancelled') return occ;
    return this.db.$transaction(async (tx) => {
      const updated = await tx.bookingOccurrence.update({
        where: { id: occurrenceId },
        data: { status: 'cancelled', cancelledAt: new Date() },
        include: occurrenceInclude,
      });
      const remaining = await tx.bookingOccurrence.count({ where: { bookingId: occ.bookingId, status: { not: 'cancelled' } } });
      if (remaining === 0 && !occ.booking.recurrenceRule) {
        await tx.booking.update({ where: { id: occ.bookingId }, data: { status: 'cancelled' } });
      }
      await audit(tx, organizationId, actor, 'booking.cancel_occurrence', 'booking_occurrence', occurrenceId, {
        before: { status: occ.status },
        after: { status: 'cancelled' },
      });
      return updated;
    });
  }

  /** Cancela a série a partir de `fromDate` (local, inclusive) e impede novas ocorrências. */
  async cancelSeries(organizationId: string, bookingId: string, fromDate: IsoDate, actor: Actor) {
    const org = await getOrganization(this.db, organizationId);
    const booking = await this.db.booking.findFirst({ where: { id: bookingId, organizationId } });
    if (!booking) throw new DomainError('not_found', 'Reserva não encontrada');
    const from = localDayBoundsUtc(fromDate, org.timezone).start;
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.bookingOccurrence.updateMany({
        where: { bookingId, status: { not: 'cancelled' }, startAt: { gte: from } },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      const remaining = await tx.bookingOccurrence.count({ where: { bookingId, status: { not: 'cancelled' } } });
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          seriesUntil: fromIsoDate(addDays(fromDate, -1)),
          ...(remaining === 0 ? { status: 'cancelled' } : {}),
        },
      });
      await audit(tx, organizationId, actor, 'booking.cancel_series', 'booking', bookingId, { after: { fromDate, cancelled: count } });
      return { cancelled: count };
    });
  }

  // ───────────── alteração ─────────────

  /** Move uma ocorrência isolada (vira exceção da série). */
  async updateOccurrence(organizationId: string, occurrenceId: string, input: { startAt: Date; endAt: Date; spaceId?: string }, actor: Actor) {
    assertInterval(input.startAt, input.endAt);
    const occ = await this.getOccurrence(organizationId, occurrenceId);
    if (occ.status === 'cancelled') throw new DomainError('validation', 'Reserva cancelada não pode ser alterada');
    const org = await getOrganization(this.db, organizationId);
    const spaceId = input.spaceId ?? occ.spaceId;
    const space = await this.db.space.findFirst({ where: { id: spaceId, organizationId, active: true }, include: { availabilityRules: true } });
    if (!space) throw new DomainError('not_found', 'Sala não encontrada');

    const conflicts = await this.findConflicts(this.db, spaceId, space.availabilityRules, [{ start: input.startAt, end: input.endAt }], org.timezone, [occurrenceId]);
    if (conflicts.length) throw new DomainError('conflict', conflictMessage(conflicts), { conflicts });
    try {
      return await this.db.$transaction(async (tx) => {
        const updated = await tx.bookingOccurrence.update({
          where: { id: occurrenceId },
          data: { startAt: input.startAt, endAt: input.endAt, spaceId, isException: !!occ.booking.recurrenceRule },
          include: occurrenceInclude,
        });
        await audit(tx, organizationId, actor, 'booking.update_occurrence', 'booking_occurrence', occurrenceId, {
          before: { startAt: occ.startAt, endAt: occ.endAt, spaceId: occ.spaceId },
          after: { startAt: input.startAt, endAt: input.endAt, spaceId },
        });
        return updated;
      });
    } catch (err) {
      if (isBookingOverlapError(err)) throw new DomainError('conflict', 'O horário acabou de ser reservado por outra pessoa.');
      throw err;
    }
  }

  /**
   * Altera o horário local da série a partir de `fromDate`. Ocorrências marcadas como exceção
   * não mudam. Com onConflict="skip", as que não couberem mantêm o horário antigo e são relatadas.
   */
  async updateSeries(
    organizationId: string,
    bookingId: string,
    input: { localStartTime: string; localEndTime: string; fromDate: IsoDate; onConflict?: 'fail' | 'skip' },
    actor: Actor,
  ) {
    if (!/^\d{2}:\d{2}$/.test(input.localStartTime) || !/^\d{2}:\d{2}$/.test(input.localEndTime) || input.localStartTime >= input.localEndTime) {
      throw new DomainError('validation', 'Horário inválido');
    }
    const org = await getOrganization(this.db, organizationId);
    const tz = org.timezone;
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, organizationId },
      include: { space: { include: { availabilityRules: true } } },
    });
    if (!booking?.recurrenceRule) throw new DomainError('not_found', 'Série não encontrada');

    const from = localDayBoundsUtc(input.fromDate, tz).start;
    const targets = await this.db.bookingOccurrence.findMany({
      where: { bookingId, status: { not: 'cancelled' }, isException: false, startAt: { gte: from } },
      orderBy: { startAt: 'asc' },
    });
    const moved = targets.map((o) => {
      const date = localDateOf(o.startAt, tz);
      return { id: o.id, start: zonedToUtc(date, input.localStartTime, tz), end: zonedToUtc(date, input.localEndTime, tz) };
    });
    const conflicts = await this.findConflicts(
      this.db,
      booking.spaceId,
      booking.space.availabilityRules,
      moved,
      tz,
      targets.map((t) => t.id),
    );
    if (conflicts.length && (input.onConflict ?? 'fail') === 'fail') {
      throw new DomainError('conflict', conflictMessage(conflicts), { conflicts });
    }
    const blocked = new Set(conflicts.map((c) => c.startAt.getTime()));
    const apply = moved.filter((m) => !blocked.has(m.start.getTime()));

    try {
      return await this.db.$transaction(async (tx) => {
        for (const m of apply) {
          await tx.bookingOccurrence.update({ where: { id: m.id }, data: { startAt: m.start, endAt: m.end } });
        }
        await tx.booking.update({
          where: { id: bookingId },
          data: { localStartTime: input.localStartTime, localEndTime: input.localEndTime },
        });
        await audit(tx, organizationId, actor, 'booking.update_series', 'booking', bookingId, {
          before: { localStartTime: booking.localStartTime, localEndTime: booking.localEndTime },
          after: { ...input, updated: apply.length, skipped: conflicts.length },
        });
        return { updated: apply.length, skipped: conflicts };
      });
    } catch (err) {
      if (isBookingOverlapError(err)) throw new DomainError('conflict', 'Outra reserva ocupou um desses horários. Tente de novo.');
      throw err;
    }
  }

  /** Job diário: materializa ocorrências de séries sem fim até o horizonte. Conflitos são pulados e relatados. */
  async extendSeries(now = new Date()) {
    const series = await this.db.booking.findMany({
      where: { recurrenceRule: { not: null }, status: { not: 'cancelled' } },
      include: { organization: true, space: { include: { availabilityRules: true } } },
    });
    const report: Array<{ bookingId: string; created: number; skipped: Conflict[] }> = [];
    for (const b of series) {
      const tz = b.organization.timezone;
      const horizonLimit = addDays(localDateOf(now, tz), SERIES_HORIZON_DAYS);
      const until = b.seriesUntil ? toIsoDate(b.seriesUntil) : null;
      const horizon = until && until < horizonLimit ? until : horizonLimit;
      const after = b.materializedUntil ? addDays(toIsoDate(b.materializedUntil), 1) : null;
      if (!after || after > horizon || !b.seriesStartsOn || !b.localStartTime || !b.localEndTime) continue;

      const rule = parseRRule(b.recurrenceRule!);
      const intervals = expandDates({ ...rule, until }, toIsoDate(b.seriesStartsOn), after, horizon).map((date) => ({
        start: zonedToUtc(date, b.localStartTime!, tz),
        end: zonedToUtc(date, b.localEndTime!, tz),
      }));
      const conflicts = await this.findConflicts(this.db, b.spaceId, b.space.availabilityRules, intervals, tz);
      const skip = new Set(conflicts.map((c) => c.startAt.getTime()));
      const toCreate = intervals.filter((i) => !skip.has(i.start.getTime()));
      try {
        await this.db.$transaction(async (tx) => {
          if (toCreate.length) {
            await tx.bookingOccurrence.createMany({
              data: toCreate.map((i) => ({
                organizationId: b.organizationId,
                bookingId: b.id,
                spaceId: b.spaceId,
                startAt: i.start,
                endAt: i.end,
                status: b.status,
              })),
            });
          }
          await tx.booking.update({ where: { id: b.id }, data: { materializedUntil: fromIsoDate(horizon) } });
        });
        report.push({ bookingId: b.id, created: toCreate.length, skipped: conflicts });
      } catch (err) {
        if (!isBookingOverlapError(err)) throw err;
        // Corrida rara: tenta de novo na próxima execução.
      }
    }
    return report;
  }

  // ───────────── regras ─────────────

  /** Para cada intervalo candidato: sobreposição, bloqueio ou fora do horário de funcionamento. */
  async findConflicts(
    db: Tx,
    spaceId: string,
    rules: OpeningRule[],
    intervals: Interval[],
    timezone: string,
    ignoreOccurrenceIds: string[] = [],
  ): Promise<Conflict[]> {
    if (intervals.length === 0) return [];
    const min = new Date(Math.min(...intervals.map((i) => i.start.getTime())));
    const max = new Date(Math.max(...intervals.map((i) => i.end.getTime())));
    const [existing, blocks] = await Promise.all([
      db.bookingOccurrence.findMany({
        where: {
          spaceId,
          status: { not: 'cancelled' },
          startAt: { lt: max },
          endAt: { gt: min },
          ...(ignoreOccurrenceIds.length ? { id: { notIn: ignoreOccurrenceIds } } : {}),
        },
        include: { booking: { select: { id: true, title: true, responsibleName: true } } },
      }),
      db.spaceBlock.findMany({ where: { spaceId, startAt: { lt: max }, endAt: { gt: min } } }),
    ]);

    const out: Conflict[] = [];
    for (const i of intervals) {
      const block = blocks.find((b) => b.startAt < i.end && i.start < b.endAt);
      if (block) {
        out.push({ startAt: i.start, endAt: i.end, reason: 'blocked', block: { id: block.id, reason: block.reason } });
        continue;
      }
      const overlap = existing.find((o) => o.startAt < i.end && i.start < o.endAt);
      if (overlap) {
        out.push({
          startAt: i.start,
          endAt: i.end,
          reason: 'overlap',
          with: {
            occurrenceId: overlap.id,
            bookingId: overlap.booking.id,
            title: overlap.booking.title,
            responsibleName: overlap.booking.responsibleName,
            startAt: overlap.startAt,
            endAt: overlap.endAt,
          },
        });
        continue;
      }
      if (!withinOperatingHours(rules, i.start, i.end, timezone)) {
        out.push({ startAt: i.start, endAt: i.end, reason: 'outside_hours' });
      }
    }
    return out;
  }
}

function assertInterval(start: Date, end: Date) {
  try {
    assertValidInterval(start, end);
  } catch {
    throw new DomainError('validation', 'O horário de início deve ser antes do fim');
  }
}

function conflictMessage(conflicts: Conflict[]): string {
  const reasons = new Set(conflicts.map((c) => c.reason));
  const parts = [
    reasons.has('overlap') ? 'já existe reserva no horário' : null,
    reasons.has('blocked') ? 'a sala está bloqueada' : null,
    reasons.has('outside_hours') ? 'fora do horário de funcionamento' : null,
  ].filter(Boolean);
  return `${conflicts.length === 1 ? 'Conflito' : `${conflicts.length} conflitos`}: ${parts.join('; ')}`;
}
