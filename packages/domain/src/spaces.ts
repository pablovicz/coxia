import { normalizeText } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError } from './common';
import type { OpeningRule } from './availability';

export interface SpaceInput {
  name: string;
  slug?: string;
  aliases?: string[];
  capacity?: number | null;
  sortOrder?: number;
}

const slugify = (s: string) =>
  normalizeText(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SpaceService {
  constructor(private readonly db: Db) {}

  list(organizationId: string, includeInactive = false) {
    return this.db.space.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { availabilityRules: { orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] } },
    });
  }

  async get(organizationId: string, spaceId: string) {
    const space = await this.db.space.findFirst({
      where: { id: spaceId, organizationId },
      include: { availabilityRules: true },
    });
    if (!space) throw new DomainError('not_found', 'Sala não encontrada');
    return space;
  }

  async create(organizationId: string, input: SpaceInput, actor: Actor) {
    const name = input.name.trim();
    if (!name) throw new DomainError('validation', 'Informe o nome da sala');
    return this.db.$transaction(async (tx) => {
      const space = await tx.space.create({
        data: {
          organizationId,
          name,
          slug: input.slug ?? slugify(name),
          aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
          capacity: input.capacity ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await audit(tx, organizationId, actor, 'space.create', 'space', space.id, { after: space });
      return space;
    });
  }

  async update(organizationId: string, spaceId: string, patch: Partial<SpaceInput> & { active?: boolean }, actor: Actor) {
    const before = await this.get(organizationId, spaceId);
    return this.db.$transaction(async (tx) => {
      const space = await tx.space.update({
        where: { id: spaceId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.aliases !== undefined ? { aliases: patch.aliases.map((a) => a.trim()).filter(Boolean) } : {}),
          ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
        },
      });
      await audit(tx, organizationId, actor, 'space.update', 'space', spaceId, { before, after: space });
      return space;
    });
  }

  /** Substitui o horário de funcionamento semanal da sala. */
  async setAvailability(organizationId: string, spaceId: string, rules: OpeningRule[], actor: Actor) {
    await this.get(organizationId, spaceId);
    for (const r of rules) {
      if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) {
        throw new DomainError('validation', 'Dia da semana inválido');
      }
      if (!HHMM.test(r.opensAt) || !HHMM.test(r.closesAt) || r.opensAt >= r.closesAt) {
        throw new DomainError('validation', `Horário inválido: ${r.opensAt}–${r.closesAt}`);
      }
    }
    return this.db.$transaction(async (tx) => {
      await tx.spaceAvailabilityRule.deleteMany({ where: { spaceId } });
      await tx.spaceAvailabilityRule.createMany({ data: rules.map((r) => ({ ...r, spaceId })) });
      await audit(tx, organizationId, actor, 'space.set_availability', 'space', spaceId, { after: rules });
      return tx.spaceAvailabilityRule.findMany({ where: { spaceId }, orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] });
    });
  }

  listBlocks(organizationId: string, from: Date, to: Date, spaceId?: string) {
    return this.db.spaceBlock.findMany({
      where: { organizationId, ...(spaceId ? { spaceId } : {}), startAt: { lt: to }, endAt: { gt: from } },
      orderBy: { startAt: 'asc' },
    });
  }

  /**
   * Bloqueia a sala (manutenção, evento interno). Não cancela reservas existentes:
   * devolve as que conflitam para a administradora decidir.
   */
  async addBlock(organizationId: string, spaceId: string, input: { startAt: Date; endAt: Date; reason?: string | null }, actor: Actor) {
    await this.get(organizationId, spaceId);
    if (!(input.startAt < input.endAt)) throw new DomainError('validation', 'O início deve ser antes do fim');
    return this.db.$transaction(async (tx) => {
      const block = await tx.spaceBlock.create({
        data: { organizationId, spaceId, startAt: input.startAt, endAt: input.endAt, reason: input.reason ?? null },
      });
      const conflicting = await tx.bookingOccurrence.findMany({
        where: { spaceId, status: { not: 'cancelled' }, startAt: { lt: input.endAt }, endAt: { gt: input.startAt } },
        include: { booking: { select: { title: true, responsibleName: true } } },
        orderBy: { startAt: 'asc' },
      });
      await audit(tx, organizationId, actor, 'space.block', 'space_block', block.id, { after: block });
      return { block, conflictingOccurrences: conflicting };
    });
  }

  async removeBlock(organizationId: string, blockId: string, actor: Actor) {
    const block = await this.db.spaceBlock.findFirst({ where: { id: blockId, organizationId } });
    if (!block) throw new DomainError('not_found', 'Bloqueio não encontrado');
    await this.db.$transaction(async (tx) => {
      await tx.spaceBlock.delete({ where: { id: blockId } });
      await audit(tx, organizationId, actor, 'space.unblock', 'space_block', blockId, { before: block });
    });
  }

  /**
   * Resolve "sala grande", "salão", "pequena" para uma sala.
   * Exato (nome/apelido) vence; senão, correspondência parcial única; senão, candidatos.
   */
  async resolveHint(organizationId: string, hint: string) {
    const spaces = await this.list(organizationId);
    return resolveSpaceHint(spaces, hint);
  }
}

export function resolveSpaceHint<S extends { name: string; slug: string; aliases: string[] }>(
  spaces: S[],
  hint: string,
): { match: S | null; candidates: S[] } {
  const h = normalizeText(hint).replace(/^(a|o)\s+/, '');
  const names = (s: S) => [s.name, s.slug.replace(/-/g, ' '), ...s.aliases].map(normalizeText);
  const exact = spaces.filter((s) => names(s).includes(h));
  if (exact.length === 1) return { match: exact[0]!, candidates: exact };
  const partial = spaces.filter((s) => names(s).some((n) => n.includes(h) || (h.length >= 4 && h.includes(n))));
  if (partial.length === 1) return { match: partial[0]!, candidates: partial };
  return { match: null, candidates: partial.length ? partial : spaces };
}
