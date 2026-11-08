import { type Actor, audit, type Db, DomainError } from './common';
import { SPACE_COLORS } from './spaces';

/** Ícones de categoria de gasto (mapeados para lucide no web em lib/expense-categories.tsx). */
export const EXPENSE_ICONS = [
  'casa',
  'estoque',
  'manutencao',
  'servicos',
  'equipamento',
  'alimentacao',
  'transporte',
  'marketing',
  'pessoal',
  'impostos',
  'eventos',
  'outros',
] as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Casa', icon: 'casa', color: 'floresta', sortOrder: 1 },
  { name: 'Estoque', icon: 'estoque', color: 'mostarda', sortOrder: 2 },
  { name: 'Manutenção', icon: 'manutencao', color: 'terracota', sortOrder: 3 },
] as const;

export interface ExpenseCategoryInput {
  name: string;
  icon?: string;
  color?: string;
}

function validate(input: Partial<ExpenseCategoryInput>) {
  if (input.name !== undefined && !input.name.trim()) throw new DomainError('validation', 'Informe o nome da categoria');
  if (input.icon !== undefined && !(EXPENSE_ICONS as readonly string[]).includes(input.icon)) throw new DomainError('validation', 'Ícone inválido');
  if (input.color !== undefined && !(SPACE_COLORS as readonly string[]).includes(input.color)) throw new DomainError('validation', 'Cor inválida');
}

const isUnique = (err: unknown) => (err as { code?: string }).code === 'P2002';

/** Categorias de gasto da casa (Casa, Estoque, Manutenção…), com ícone e cor. */
export class ExpenseCategoryService {
  constructor(private readonly db: Db) {}

  /** Lista as ativas; organização sem nenhuma ganha as três iniciais. */
  async list(organizationId: string, includeArchived = false) {
    if ((await this.db.expenseCategory.count({ where: { organizationId } })) === 0) {
      await this.db.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ organizationId, ...c })),
        skipDuplicates: true,
      });
    }
    return this.db.expenseCategory.findMany({
      where: { organizationId, ...(includeArchived ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(organizationId: string, input: ExpenseCategoryInput, actor: Actor) {
    validate(input);
    const last = await this.db.expenseCategory.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
    try {
      return await this.db.$transaction(async (tx) => {
        const c = await tx.expenseCategory.create({
          data: {
            organizationId,
            name: input.name.trim(),
            icon: input.icon ?? 'outros',
            color: input.color ?? 'grafite',
            sortOrder: (last._max.sortOrder ?? 0) + 1,
          },
        });
        await audit(tx, organizationId, actor, 'expense_category.create', 'expense_category', c.id, { after: c });
        return c;
      });
    } catch (err) {
      if (isUnique(err)) throw new DomainError('conflict', `Já existe a categoria ${input.name.trim()}`);
      throw err;
    }
  }

  async update(organizationId: string, id: string, patch: Partial<ExpenseCategoryInput> & { active?: boolean }, actor: Actor) {
    validate(patch);
    const before = await this.db.expenseCategory.findFirst({ where: { id, organizationId } });
    if (!before) throw new DomainError('not_found', 'Categoria não encontrada');
    try {
      return await this.db.$transaction(async (tx) => {
        const c = await tx.expenseCategory.update({
          where: { id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.active !== undefined ? { active: patch.active } : {}),
          },
        });
        await audit(tx, organizationId, actor, 'expense_category.update', 'expense_category', id, { before, after: c });
        return c;
      });
    } catch (err) {
      if (isUnique(err)) throw new DomainError('conflict', `Já existe a categoria ${patch.name?.trim()}`);
      throw err;
    }
  }
}
