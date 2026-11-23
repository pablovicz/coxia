import type { Prisma } from '@coxia/database';
import { normalizePhone, normalizeText, parsePanelPhone } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError } from './common';

/** Pessoa vista na lista de participantes de um grupo ou num aviso de entrada. */
export interface SeenParticipant {
  phone: string;
  name?: string | null;
  isAdmin?: boolean;
}

/** Telefone válido para contato: só dígitos, 10 a 15 (DDI + DDD + número). */
const validPhone = (raw: string | null | undefined): string | null => {
  const p = normalizePhone(raw);
  return p && p.length >= 10 && p.length <= 15 ? p : null;
};

const searchOf = (name: string | null | undefined, whatsappName: string | null | undefined) =>
  normalizeText([name, whatsappName].filter(Boolean).join(' '));

const contactInclude = {
  groups: {
    where: { leftAt: null },
    orderBy: { joinedAt: 'asc' },
    select: { isAdmin: true, joinedAt: true, group: { select: { id: true, name: true } } },
  },
  type: { select: { id: true, name: true } },
} satisfies Prisma.ContactInclude;

/**
 * Contatos: quem está nos grupos do WhatsApp da organização (e quem escreve direto para a Coxia).
 * A equipe manipula os grupos pelo WhatsApp; aqui só registramos quem entra, sai e escreve,
 * para identificar e buscar as pessoas no painel.
 */
export class ContactService {
  constructor(private readonly db: Db) {}

  /** Mensagem recebida: registra o remetente e, em grupo, a participação. Ignora o próprio número. */
  async recordMessage(
    organizationId: string,
    input: { phone: string | null; whatsappName: string | null; groupId: string | null; at: Date; ownPhone?: string | null },
  ) {
    const phone = validPhone(input.phone);
    if (!phone || phone === validPhone(input.ownPhone)) return null;
    const whatsappName = input.whatsappName?.trim() || null;
    const contact = await this.upsertContact(organizationId, phone, whatsappName);
    // Só avança: mensagens reprocessadas fora de ordem não voltam a "última mensagem".
    await this.db.contact.updateMany({
      where: { id: contact.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: input.at } }] },
      data: { lastMessageAt: input.at },
    });
    if (input.groupId) await this.join(contact.id, input.groupId, input.at);
    return contact;
  }

  /** Aviso de participante adicionado/entrou no grupo. */
  async addToGroup(organizationId: string, groupId: string, participants: SeenParticipant[], at: Date, ownPhone?: string | null) {
    const own = validPhone(ownPhone);
    const added: string[] = [];
    for (const p of participants) {
      const phone = validPhone(p.phone);
      if (!phone || phone === own) continue;
      const contact = await this.upsertContact(organizationId, phone, p.name?.trim() || null);
      await this.join(contact.id, groupId, at, p.isAdmin);
      added.push(phone);
    }
    return added;
  }

  /** Aviso de participante removido/saiu: a participação fica no histórico com a data de saída. */
  async removeFromGroup(organizationId: string, groupId: string, phones: string[], at: Date) {
    const valid = phones.map(validPhone).filter((p): p is string => !!p);
    if (!valid.length) return 0;
    const res = await this.db.contactGroup.updateMany({
      where: { groupId, leftAt: null, contact: { organizationId, phone: { in: valid } } },
      data: { leftAt: at },
    });
    return res.count;
  }

  /**
   * Lista completa de participantes vinda do provedor: quem está entra (ou volta),
   * quem não está mais sai. É a fonte mais confiável; os avisos individuais só adiantam.
   */
  async syncGroup(organizationId: string, groupId: string, participants: SeenParticipant[], at: Date, ownPhone?: string | null) {
    const present = await this.addToGroup(organizationId, groupId, participants, at, ownPhone);
    const left = await this.db.contactGroup.updateMany({
      where: { groupId, leftAt: null, contact: { organizationId, phone: { notIn: present } } },
      data: { leftAt: at },
    });
    await this.db.whatsappGroup.update({ where: { id: groupId }, data: { contactsSyncedAt: at } });
    return { present: present.length, left: left.count };
  }

  /** Busca por nome (sem acento), nome no WhatsApp ou trecho do telefone; filtro por grupo. */
  /** `typeId`: um tipo cadastrado, ou "none" para quem não tem tipo. `kind`: residente, lead ou contato comum. */
  async list(organizationId: string, opts: { q?: string; groupId?: string; kind?: 'contact' | 'resident' | 'lead'; typeId?: string; take?: number; skip?: number } = {}) {
    const q = opts.q?.trim() ?? '';
    const digits = q.replace(/\D/g, '');
    // Só letras, números e espaço: % e _ seriam curingas no LIKE do banco.
    const text = normalizeText(q).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
    const where: Prisma.ContactWhereInput = {
      organizationId,
      ...(opts.groupId ? { groups: { some: { groupId: opts.groupId, leftAt: null } } } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.typeId ? { typeId: opts.typeId === 'none' ? null : opts.typeId } : {}),
      ...(q
        ? {
            OR: [
              ...(text ? [{ searchName: { contains: text } }] : []),
              ...(digits.length >= 2 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    if (q && !text && digits.length < 2) return { items: [], total: 0 };
    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const [rows, total] = await Promise.all([
      this.db.contact.findMany({
        where,
        include: contactInclude,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take,
        skip: opts.skip ?? 0,
      }),
      this.db.contact.count({ where }),
    ]);
    return { items: await this.withTeam(organizationId, rows), total };
  }

  async get(organizationId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, organizationId },
      include: {
        groups: {
          orderBy: [{ leftAt: { sort: 'desc', nulls: 'first' } }, { joinedAt: 'asc' }],
          select: { isAdmin: true, joinedAt: true, leftAt: true, group: { select: { id: true, name: true } } },
        },
        type: { select: { id: true, name: true } },
      },
    });
    if (!contact) throw new DomainError('not_found', 'Contato não encontrado');
    const [withTeam] = await this.withTeam(organizationId, [contact]);
    return withTeam!;
  }

  /**
   * Cartão de contato enviado pela equipe no WhatsApp: cada telefone vira contato.
   * O nome do cartão (como a equipe salvou a pessoa) vira o nome do contato, sem
   * sobrescrever um nome que a equipe já tenha dado. Ignora o próprio número da Coxia.
   */
  async saveFromCards(
    organizationId: string,
    cards: Array<{ name: string | null; phones: string[] }>,
    actor: Actor,
    ownPhone?: string | null,
  ): Promise<Array<{ contactId: string; phone: string; name: string | null; created: boolean }>> {
    const own = validPhone(ownPhone);
    const out: Array<{ contactId: string; phone: string; name: string | null; created: boolean }> = [];
    for (const card of cards) {
      const cardName = card.name?.trim() || null;
      for (const raw of card.phones) {
        const phone = validPhone(raw);
        if (!phone || phone === own || out.some((o) => o.phone === phone)) continue;
        const existing = await this.db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
        const contact = existing ?? (await this.upsertContact(organizationId, phone, null));
        const name = contact.name ?? cardName;
        if (name !== contact.name) {
          await this.db.contact.update({ where: { id: contact.id }, data: { name, searchName: searchOf(name, contact.whatsappName) } });
        }
        if (!existing) await audit(this.db, organizationId, actor, 'contact.create_from_card', 'contact', contact.id, { after: { phone, name } });
        out.push({ contactId: contact.id, phone, name, created: !existing });
      }
    }
    return out;
  }

  /** Cadastro manual de um contato (nome e WhatsApp). Número já cadastrado: conflito com o id dele. */
  async create(organizationId: string, input: { name: string; phone: string; notes?: string | null; typeId?: string | null }, actor: Actor) {
    const name = input.name?.trim();
    if (!name) throw new DomainError('validation', 'Informe o nome do contato');
    const phone = parsePanelPhone(input.phone);
    if (!phone) throw new DomainError('validation', 'WhatsApp inválido: use DDD e número, ou + e o código do país');
    const existing = await this.db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
    if (existing) throw new DomainError('conflict', 'Este número já está nos contatos', { code: 'contact_exists', contactId: existing.id });
    const typeId = await this.validType(organizationId, input.typeId);
    try {
      const created = await this.db.$transaction(async (tx) => {
        const c = await tx.contact.create({ data: { organizationId, phone, name, notes: input.notes?.trim() || null, typeId, searchName: searchOf(name, null) } });
        await audit(tx, organizationId, actor, 'contact.create', 'contact', c.id, { after: { phone, name } });
        return c;
      });
      return this.get(organizationId, created.id);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new DomainError('conflict', 'Este número já está nos contatos', { code: 'contact_exists' });
      throw err;
    }
  }

  /** A equipe corrige o nome (o do WhatsApp pode ser apelido) e anota observações. */
  async update(organizationId: string, contactId: string, patch: { name?: string | null; notes?: string | null; typeId?: string | null }, actor: Actor) {
    const before = await this.get(organizationId, contactId);
    const name = patch.name !== undefined ? patch.name?.trim() || null : before.name;
    const notes = patch.notes !== undefined ? patch.notes?.trim() || null : before.notes;
    const typeId = patch.typeId !== undefined ? await this.validType(organizationId, patch.typeId) : before.typeId;
    await this.db.$transaction(async (tx) => {
      await tx.contact.update({ where: { id: contactId }, data: { name, notes, typeId, searchName: searchOf(name, before.whatsappName) } });
      await audit(tx, organizationId, actor, 'contact.update', 'contact', contactId, {
        before: { name: before.name, notes: before.notes, typeId: before.typeId },
        after: { name, notes, typeId },
      });
    });
    return this.get(organizationId, contactId);
  }

  /**
   * Nome e foto do WhatsApp (perfil público). O nome dado pela equipe não muda;
   * a foto é uma URL temporária do provedor, renovada pelo worker.
   */
  async applyWhatsappProfile(contactId: string, profile: { name: string | null; photoUrl: string | null }, at = new Date()) {
    const c = await this.db.contact.findUnique({ where: { id: contactId } });
    if (!c) return null;
    const whatsappName = profile.name?.trim() || c.whatsappName;
    return this.db.contact.update({
      where: { id: contactId },
      data: { whatsappName, photoUrl: profile.photoUrl, profileFetchedAt: at, searchName: searchOf(c.name, whatsappName) },
    });
  }

  private async validType(organizationId: string, typeId: string | null | undefined) {
    if (!typeId) return null;
    const t = await this.db.contactType.findFirst({ where: { id: typeId, organizationId } });
    if (!t) throw new DomainError('not_found', 'Tipo de contato não encontrado');
    return t.id;
  }

  /** Grupos para o filtro, com quantas pessoas estão em cada um agora. */
  async listGroups(organizationId: string) {
    const groups = await this.db.whatsappGroup.findMany({
      where: { organizationId },
      select: { id: true, name: true, _count: { select: { members: { where: { leftAt: null } } } } },
      orderBy: { name: 'asc' },
    });
    return groups.map((g) => ({ id: g.id, name: g.name, members: g._count.members }));
  }

  // ───────────── internos ─────────────

  private async upsertContact(organizationId: string, phone: string, whatsappName: string | null) {
    const existing = await this.db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
    if (existing) {
      if (whatsappName && whatsappName !== existing.whatsappName) {
        return this.db.contact.update({
          where: { id: existing.id },
          data: { whatsappName, searchName: searchOf(existing.name, whatsappName) },
        });
      }
      return existing;
    }
    try {
      return await this.db.contact.create({
        data: { organizationId, phone, whatsappName, searchName: searchOf(null, whatsappName) },
      });
    } catch (err) {
      // Duas mensagens da mesma pessoa ao mesmo tempo: a outra criou primeiro.
      if ((err as { code?: string }).code === 'P2002') {
        return this.db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId, phone } } });
      }
      throw err;
    }
  }

  private async join(contactId: string, groupId: string, at: Date, isAdmin?: boolean) {
    await this.db.contactGroup.upsert({
      where: { contactId_groupId: { contactId, groupId } },
      create: { contactId, groupId, joinedAt: at, isAdmin: isAdmin ?? false },
      // Voltou ao grupo: reabre a participação (a data de entrada original fica).
      update: { leftAt: null, ...(isAdmin !== undefined ? { isAdmin } : {}) },
    });
  }

  /** Marca quem é da equipe (mesmo telefone de um membro da organização). */
  private async withTeam<C extends { phone: string }>(organizationId: string, rows: C[]) {
    if (!rows.length) return [];
    const members = await this.db.organizationMember.findMany({
      where: { organizationId, user: { phone: { in: rows.map((r) => r.phone) } } },
      select: { role: true, user: { select: { id: true, name: true, phone: true, avatarUpdatedAt: true } } },
    });
    const byPhone = new Map(members.map((m) => [m.user.phone!, { userId: m.user.id, name: m.user.name, role: m.role, avatarUpdatedAt: m.user.avatarUpdatedAt }]));
    return rows.map((r) => ({ ...r, member: byPhone.get(r.phone) ?? null }));
  }
}

/** "+55 11 98765-4321" para mensagens de WhatsApp. */
function phoneLabel(digits: string): string {
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${digits}`;
}

/** Resposta da Coxia (só em conversa direta) depois de salvar cartões de contato. */
export function contactCardReply(saved: Array<{ phone: string; name: string | null; created: boolean }>): string {
  if (saved.length === 0) return 'Não consegui ler o telefone desse contato. Pode me mandar o nome e o número por escrito?';
  const label = (s: { phone: string; name: string | null }) => (s.name ? `${s.name} · ${phoneLabel(s.phone)}` : phoneLabel(s.phone));
  const created = saved.filter((s) => s.created);
  const known = saved.filter((s) => !s.created);
  const lines: string[] = [];
  if (created.length === 1) lines.push(`📇 Contato salvo: ${label(created[0]!)}`);
  else if (created.length > 1) lines.push(`📇 ${created.length} contatos salvos:`, ...created.map((s) => `• ${label(s)}`));
  if (known.length === 1) lines.push(`${created.length ? '' : '📇 '}${label(known[0]!)} já estava nos contatos.`);
  else if (known.length > 1) lines.push(`${created.length ? 'Já estavam' : '📇 Já estavam'} nos contatos:`, ...known.map((s) => `• ${label(s)}`));
  return lines.join('\n');
}
