import type { SpaceStatus } from '@coxia/database';
import { normalizeText } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError } from './common';
import type { OpeningRule } from './availability';
import { IncomeService } from './incomes';

/** Paleta de salas (cores definidas no web em lib/rooms.ts, claro e escuro). */
export const SPACE_COLORS = ['floresta', 'terracota', 'azul', 'mostarda', 'ameixa', 'petroleo', 'rosa', 'grafite'] as const;
/** Ícones de sala (mapeados para lucide no web em lib/rooms.ts). */
export const SPACE_ICONS = [
  'palco',
  'musica',
  'poltrona',
  'paleta',
  'microfone',
  'camera',
  'pessoas',
  'porta',
  'livro',
  'apresentacao',
  'piano',
  'cafe',
  'jardim',
  'estrela',
] as const;
export const SPACE_STATUSES = ['available', 'unavailable', 'monthly_rental'] as const satisfies readonly SpaceStatus[];
export const MAX_SPACE_PHOTOS = 8;

export type SpaceColor = (typeof SPACE_COLORS)[number];
export type SpaceIcon = (typeof SPACE_ICONS)[number];

export interface SpaceInput {
  name: string;
  slug?: string;
  description?: string | null;
  aliases?: string[];
  capacity?: number | null;
  sortOrder?: number;
  status?: SpaceStatus;
  color?: SpaceColor;
  icon?: SpaceIcon;
  /** Preço da hora de locação (reserva avulsa). */
  hourlyRateCents?: number | null;
  /** Aluguel mensal (sala alugada): vira entrada prevista todo mês. */
  rentAmountCents?: number | null;
  rentDueDay?: number | null;
  tenantName?: string | null;
}

/** Horário padrão de sala nova: segunda a sábado, 08:00–22:00 (ajustável na tela Salas). */
export const DEFAULT_OPENING_RULES: OpeningRule[] = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '22:00' }));

/** Só sala disponível recebe reservas; as outras explicam o motivo (painel e WhatsApp). */
export function assertBookable(space: { name: string; status: SpaceStatus }) {
  if (space.status === 'monthly_rental') {
    throw new DomainError('validation', `A ${space.name} está alugada mensalmente e não recebe reservas avulsas`, { code: 'space_rented' });
  }
  if (space.status === 'unavailable') {
    throw new DomainError('validation', `A ${space.name} está indisponível para reservas no momento`, { code: 'space_unavailable' });
  }
}

function validateRent(input: { rentAmountCents?: number | null; rentDueDay?: number | null; hourlyRateCents?: number | null }) {
  if (input.hourlyRateCents != null && (!Number.isInteger(input.hourlyRateCents) || input.hourlyRateCents <= 0)) {
    throw new DomainError('validation', 'Valor da hora inválido');
  }
  if (input.rentAmountCents != null && (!Number.isInteger(input.rentAmountCents) || input.rentAmountCents <= 0)) {
    throw new DomainError('validation', 'Valor do aluguel inválido');
  }
  if (input.rentDueDay != null && (!Number.isInteger(input.rentDueDay) || input.rentDueDay < 1 || input.rentDueDay > 31)) {
    throw new DomainError('validation', 'Dia do aluguel entre 1 e 31');
  }
}

function validateLook(input: { color?: string; icon?: string; status?: string }) {
  if (input.color !== undefined && !(SPACE_COLORS as readonly string[]).includes(input.color)) {
    throw new DomainError('validation', 'Cor de sala inválida');
  }
  if (input.icon !== undefined && !(SPACE_ICONS as readonly string[]).includes(input.icon)) {
    throw new DomainError('validation', 'Ícone de sala inválido');
  }
  if (input.status !== undefined && !(SPACE_STATUSES as readonly string[]).includes(input.status)) {
    throw new DomainError('validation', 'Situação de sala inválida');
  }
}

function validateRules(rules: OpeningRule[]) {
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) {
      throw new DomainError('validation', 'Dia da semana inválido');
    }
    if (!HHMM.test(r.opensAt) || !HHMM.test(r.closesAt) || r.opensAt >= r.closesAt) {
      throw new DomainError('validation', `Horário inválido: ${r.opensAt}–${r.closesAt}`);
    }
  }
}

const photoSelect = { id: true, contentType: true, sortOrder: true } as const;

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
      include: {
        availabilityRules: { orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] },
        photos: { select: photoSelect, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
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

  async create(organizationId: string, input: SpaceInput & { availability?: OpeningRule[] }, actor: Actor) {
    const name = input.name.trim();
    if (!name) throw new DomainError('validation', 'Informe o nome da sala');
    validateLook(input);
    validateRent(input);
    const rules = input.availability ?? DEFAULT_OPENING_RULES;
    validateRules(rules);
    const slug = input.slug ?? slugify(name);
    const taken = await this.db.space.findFirst({ where: { organizationId, slug }, select: { id: true } });
    if (taken) throw new DomainError('conflict', `Já existe uma sala chamada ${name}`, { code: 'duplicate_space' });
    const created = await this.db.$transaction(async (tx) => {
      const last = await tx.space.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
      const space = await tx.space.create({
        data: {
          organizationId,
          name,
          slug,
          description: input.description?.trim() || null,
          aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
          capacity: input.capacity ?? null,
          sortOrder: input.sortOrder ?? (last._max.sortOrder ?? 0) + 1,
          ...(input.status ? { status: input.status } : {}),
          ...(input.color ? { color: input.color } : {}),
          ...(input.icon ? { icon: input.icon } : {}),
          hourlyRateCents: input.hourlyRateCents ?? null,
          rentAmountCents: input.rentAmountCents ?? null,
          rentDueDay: input.rentDueDay ?? null,
          tenantName: input.tenantName?.trim() || null,
        },
      });
      await tx.spaceAvailabilityRule.createMany({ data: rules.map((r) => ({ ...r, spaceId: space.id })) });
      await audit(tx, organizationId, actor, 'space.create', 'space', space.id, { after: { ...space, availability: rules } });
      return space;
    });
    // Sala já cadastrada como alugada: o aluguel do mês vira entrada prevista.
    if (created.status === 'monthly_rental') await new IncomeService(this.db).syncRentalsOfSpace(organizationId, created.id);
    return created;
  }

  /**
   * Atualiza a sala. Ao deixar de estar disponível, as reservas futuras não são canceladas:
   * vêm em `futureOccurrences` para a administração decidir (mesma política do bloqueio).
   */
  async update(organizationId: string, spaceId: string, patch: Partial<SpaceInput> & { active?: boolean }, actor: Actor, now = new Date()) {
    validateLook(patch);
    validateRent(patch);
    if (patch.name !== undefined && !patch.name.trim()) throw new DomainError('validation', 'Informe o nome da sala');
    const before = await this.get(organizationId, spaceId);
    const space = await this.db.$transaction(async (tx) => {
      const updated = await tx.space.update({
        where: { id: spaceId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
          ...(patch.aliases !== undefined ? { aliases: patch.aliases.map((a) => a.trim()).filter(Boolean) } : {}),
          ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(patch.hourlyRateCents !== undefined ? { hourlyRateCents: patch.hourlyRateCents } : {}),
          ...(patch.rentAmountCents !== undefined ? { rentAmountCents: patch.rentAmountCents } : {}),
          ...(patch.rentDueDay !== undefined ? { rentDueDay: patch.rentDueDay } : {}),
          ...(patch.tenantName !== undefined ? { tenantName: patch.tenantName?.trim() || null } : {}),
        },
      });
      await audit(tx, organizationId, actor, 'space.update', 'space', spaceId, { before, after: updated });
      return updated;
    });
    // Aluguel mensal: gera, ajusta ou cancela as entradas previstas a partir de hoje.
    if (space.status === 'monthly_rental' || before.status === 'monthly_rental') {
      await new IncomeService(this.db).syncRentalsOfSpace(organizationId, spaceId, now);
    }
    const closed = space.status !== 'available' || !space.active;
    const futureOccurrences = closed
      ? await this.db.bookingOccurrence.findMany({
          where: { spaceId, status: { not: 'cancelled' }, startAt: { gte: now } },
          include: { booking: { select: { title: true, responsibleName: true } } },
          orderBy: { startAt: 'asc' },
          take: 50,
        })
      : [];
    return { ...space, futureOccurrences };
  }

  // ───────────── fotos ─────────────

  async getPhoto(organizationId: string, spaceId: string, photoId: string) {
    const photo = await this.db.spacePhoto.findFirst({ where: { id: photoId, spaceId, organizationId } });
    if (!photo) throw new DomainError('not_found', 'Foto não encontrada');
    return photo;
  }

  /** Registra a foto já gravada no bucket. O limite por sala vale sob lock da sala (uploads paralelos). */
  async addPhoto(
    organizationId: string,
    spaceId: string,
    photo: { storageKey: string; contentType: string; sizeBytes: number },
    actor: Actor,
  ) {
    await this.get(organizationId, spaceId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM spaces WHERE id = ${spaceId} FOR UPDATE`;
      const agg = await tx.spacePhoto.aggregate({ where: { spaceId }, _count: true, _max: { sortOrder: true } });
      if (agg._count >= MAX_SPACE_PHOTOS) {
        throw new DomainError('validation', `Cada sala pode ter até ${MAX_SPACE_PHOTOS} fotos`, { code: 'too_many_photos' });
      }
      const created = await tx.spacePhoto.create({
        data: { organizationId, spaceId, ...photo, sortOrder: (agg._max.sortOrder ?? -1) + 1 },
        select: photoSelect,
      });
      await audit(tx, organizationId, actor, 'space.photo_add', 'space', spaceId, { after: { photoId: created.id } });
      return created;
    });
  }

  /** Remove o registro e devolve a foto para o chamador apagar o objeto do bucket. */
  async removePhoto(organizationId: string, spaceId: string, photoId: string, actor: Actor) {
    const photo = await this.getPhoto(organizationId, spaceId, photoId);
    await this.db.$transaction(async (tx) => {
      await tx.spacePhoto.delete({ where: { id: photoId } });
      await audit(tx, organizationId, actor, 'space.photo_remove', 'space', spaceId, { before: { photoId } });
    });
    return photo;
  }

  /** Substitui o horário de funcionamento semanal da sala. */
  async setAvailability(organizationId: string, spaceId: string, rules: OpeningRule[], actor: Actor) {
    await this.get(organizationId, spaceId);
    validateRules(rules);
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
