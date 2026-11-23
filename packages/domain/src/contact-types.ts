import { type Actor, audit, type Db, DomainError } from './common';

const NAME_MAX = 60;

/**
 * Tipos de contato cadastrados pela equipe (Costureiras, Pintores, Encanadores…).
 * "Residente" e "Lead" (pediu orçamento) não ficam aqui: são automáticos (contato.kind).
 */
export class ContactTypeService {
  constructor(private readonly db: Db) {}

  async list(organizationId: string) {
    const types = await this.db.contactType.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    });
    return types.map(({ _count, ...t }) => ({ ...t, contacts: _count.contacts }));
  }

  async create(organizationId: string, rawName: string, actor: Actor) {
    const name = this.validName(rawName);
    await this.assertFree(organizationId, name);
    return this.db.$transaction(async (tx) => {
      const t = await tx.contactType.create({ data: { organizationId, name } });
      await audit(tx, organizationId, actor, 'contact_type.create', 'contact_type', t.id, { after: { name } });
      return t;
    });
  }

  async rename(organizationId: string, id: string, rawName: string, actor: Actor) {
    const before = await this.get(organizationId, id);
    const name = this.validName(rawName);
    if (name !== before.name) await this.assertFree(organizationId, name, id);
    return this.db.$transaction(async (tx) => {
      const t = await tx.contactType.update({ where: { id }, data: { name } });
      await audit(tx, organizationId, actor, 'contact_type.rename', 'contact_type', id, { before: { name: before.name }, after: { name } });
      return t;
    });
  }

  /** Apaga o tipo; os contatos dele ficam sem tipo (não são apagados). */
  async remove(organizationId: string, id: string, actor: Actor) {
    const before = await this.get(organizationId, id);
    await this.db.$transaction(async (tx) => {
      await tx.contactType.delete({ where: { id } });
      await audit(tx, organizationId, actor, 'contact_type.delete', 'contact_type', id, { before: { name: before.name } });
    });
    return { removed: true };
  }

  async get(organizationId: string, id: string) {
    const t = await this.db.contactType.findFirst({ where: { id, organizationId } });
    if (!t) throw new DomainError('not_found', 'Tipo de contato não encontrado');
    return t;
  }

  private validName(raw: string) {
    const name = raw?.trim().replace(/\s+/g, ' ');
    if (!name) throw new DomainError('validation', 'Informe o nome do tipo');
    if (name.length > NAME_MAX) throw new DomainError('validation', `Nome com até ${NAME_MAX} caracteres`);
    if (/^(residentes?|leads?)$/i.test(name)) throw new DomainError('validation', 'Residente e Lead já são tipos automáticos', { code: 'reserved_type' });
    return name;
  }

  private async assertFree(organizationId: string, name: string, exceptId?: string) {
    const existing = await this.db.contactType.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (existing) throw new DomainError('conflict', 'Já existe um tipo com esse nome', { code: 'type_exists' });
  }
}
