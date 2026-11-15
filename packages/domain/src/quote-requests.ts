import type { QuoteRequestStatus } from '@coxia/database';
import { enqueueDelivery } from '@coxia/database';
import { type IsoDate, normalizeBrPhone, normalizeText } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError, fromIsoDate, toIsoDate } from './common';

/** Segmento do projeto (rótulos como no formulário do site). */
export const QUOTE_SEGMENTS = {
  theater: 'Teatro',
  audiovisual: 'Audiovisual',
  large_event: 'Shows / eventos de grande porte',
  private_event: 'Evento particular',
  other: 'Outro',
} as const;

/** Serviços que o site oferece: design cênico, aluguel dos espaços e cursos. */
export const QUOTE_SERVICES = {
  costume: 'Figurino',
  set_design: 'Cenografia',
  lighting: 'Iluminação',
  props: 'Adereços',
  puppets: 'Bonecos',
  space_rental: 'Aluguel de espaço',
  course: 'Cursos',
  other: 'Outro',
} as const;

export type QuoteSegment = keyof typeof QUOTE_SEGMENTS;
export type QuoteService = keyof typeof QUOTE_SERVICES;

export interface QuoteRequestInput {
  name: string;
  email: string;
  phone: string;
  segment: string;
  services: string[];
  description: string;
  neededBy?: IsoDate | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Mesmo pedido enviado de novo (duplo clique, recarregar): não duplica nem avisa de novo. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const SYSTEM: Actor = { channel: 'system', userId: null };

const isSegment = (v: string): v is QuoteSegment => Object.hasOwn(QUOTE_SEGMENTS, v);
const isService = (v: string): v is QuoteService => Object.hasOwn(QUOTE_SERVICES, v);

/** Telefone para leitura no aviso: +55 41 99907-1145. */
function phoneLabel(phone: string) {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${phone}`;
}

/** Aviso para as administradoras no WhatsApp. */
export function composeQuoteRequestNotice(r: {
  name: string;
  email: string;
  phone: string;
  segment: string;
  services: string[];
  description: string;
  neededBy: IsoDate | null;
}) {
  const services = r.services.map((s) => (isService(s) ? QUOTE_SERVICES[s] : s)).join(', ');
  const description = r.description.length > 600 ? `${r.description.slice(0, 600)}…` : r.description;
  return [
    '📩 *Novo pedido de orçamento pelo site*',
    '',
    `*${r.name}*`,
    `WhatsApp: ${phoneLabel(r.phone)}`,
    `E-mail: ${r.email}`,
    `Segmento: ${isSegment(r.segment) ? QUOTE_SEGMENTS[r.segment] : r.segment}`,
    `Serviços: ${services}`,
    r.neededBy ? `Para quando: ${r.neededBy.split('-').reverse().join('/')}` : null,
    '',
    description,
    '',
    'Veja e acompanhe em Coxia → Pedidos.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

const dateBr = (iso: IsoDate) => iso.split('-').reverse().join('/');
const OBJECTIVE_MAX = 2000;

/**
 * Rascunho do projeto a partir do orçamento ("Promover a projeto"): nome sugerido e objetivo com
 * o que o cliente escreveu, o segmento, os serviços e o prazo. A equipe ajusta antes de criar.
 */
export function projectDraftFromQuote(q: { name: string; segment: string; services: string[]; description: string; neededBy: IsoDate | null }) {
  const services = q.services.map((s) => (isService(s) ? QUOTE_SERVICES[s] : s));
  const segment = isSegment(q.segment) ? QUOTE_SEGMENTS[q.segment] : q.segment;
  const facts = [`Cliente: ${q.name}`, `Segmento: ${segment}`, `Serviços: ${services.join(', ')}`, q.neededBy ? `Para quando: ${dateBr(q.neededBy)}` : null]
    .filter(Boolean)
    .join(' · ');
  const room = OBJECTIVE_MAX - facts.length - 2;
  const description = q.description.length > room ? `${q.description.slice(0, room - 1)}…` : q.description;
  return { title: `${services[0] ?? 'Projeto'} - ${q.name}`.slice(0, 120), objective: `${description}\n\n${facts}` };
}

/**
 * Pedidos de orçamento do site público. Quem pede vira contato (pelo WhatsApp) e as
 * administradoras recebem o aviso no WhatsApp; a equipe acompanha em "Pedidos".
 */
export class QuoteRequestService {
  constructor(private readonly db: Db) {}

  /** Organização que recebe os pedidos do site: pelo slug ou, sem slug, a única que existe. */
  async siteOrganizationId(slug?: string | null) {
    if (slug) {
      const org = await this.db.organization.findUnique({ where: { slug }, select: { id: true } });
      if (!org) throw new DomainError('not_found', 'Organização do site não encontrada');
      return org.id;
    }
    const orgs = await this.db.organization.findMany({ select: { id: true }, take: 2 });
    if (orgs.length !== 1) throw new DomainError('not_found', 'Defina a organização do site');
    return orgs[0]!.id;
  }

  private validate(input: QuoteRequestInput) {
    const name = input.name?.trim().replace(/\s+/g, ' ') ?? '';
    if (name.length < 2 || name.length > 120) throw new DomainError('validation', 'Informe seu nome');
    const email = input.email?.trim().toLowerCase() ?? '';
    if (!EMAIL_RE.test(email) || email.length > 200) throw new DomainError('validation', 'E-mail inválido');
    const phone = normalizeBrPhone(input.phone);
    if (!phone || phone.length < 12 || phone.length > 15) throw new DomainError('validation', 'WhatsApp inválido: informe DDD e número');
    if (!isSegment(input.segment)) throw new DomainError('validation', 'Escolha o segmento');
    const services = [...new Set(input.services ?? [])];
    if (!services.length || !services.every(isService)) throw new DomainError('validation', 'Escolha pelo menos um serviço');
    const description = input.description?.trim() ?? '';
    if (description.length < 10) throw new DomainError('validation', 'Conte um pouco sobre o projeto');
    if (description.length > 4000) throw new DomainError('validation', 'A descrição deve ter até 4.000 caracteres');
    const neededBy = input.neededBy || null;
    if (neededBy && !ISO_DATE_RE.test(neededBy)) throw new DomainError('validation', 'Data inválida');
    return { name, email, phone, segment: input.segment, services, description, neededBy };
  }

  /** Recebe o pedido do site: grava, liga ao contato e avisa as administradoras no WhatsApp. */
  async submit(organizationId: string, input: QuoteRequestInput, now = new Date()) {
    const r = this.validate(input);
    const duplicate = await this.db.quoteRequest.findFirst({
      where: { organizationId, phone: r.phone, description: r.description, createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) } },
    });
    if (duplicate) return { id: duplicate.id, duplicate: true };

    const admins = await this.db.organizationMember.findMany({
      where: { organizationId, role: { in: ['owner', 'admin'] }, user: { phone: { not: null } } },
      select: { user: { select: { phone: true } } },
    });
    const created = await this.db.$transaction(async (tx) => {
      // Contato pelo WhatsApp: novo recebe o nome do formulário; o existente mantém o nome dado pela equipe.
      const existing = await tx.contact.findUnique({ where: { organizationId_phone: { organizationId, phone: r.phone } } });
      const contact =
        existing ??
        (await tx.contact.create({
          data: { organizationId, phone: r.phone, name: r.name, notes: `Pedido de orçamento pelo site (${r.email})`, searchName: normalizeText(r.name) },
        }));
      const q = await tx.quoteRequest.create({
        data: {
          organizationId,
          contactId: contact.id,
          name: r.name,
          email: r.email,
          phone: r.phone,
          segment: r.segment,
          services: r.services,
          description: r.description,
          neededBy: r.neededBy ? fromIsoDate(r.neededBy) : null,
        },
      });
      await audit(tx, organizationId, SYSTEM, 'quote_request.create', 'quote_request', q.id, { after: { name: r.name, segment: r.segment, services: r.services } });
      const text = composeQuoteRequestNotice(r);
      for (const a of admins) {
        await enqueueDelivery(tx, { organizationId, recipient: a.user.phone!, text, idempotencyKey: `quote_request:${q.id}:${a.user.phone}` });
      }
      return q;
    });
    return { id: created.id, duplicate: false };
  }

  async list(organizationId: string, status?: QuoteRequestStatus) {
    const [items, grouped] = await Promise.all([
      this.db.quoteRequest.findMany({
        where: { organizationId, ...(status ? { status } : {}) },
        include: projectInclude,
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.db.quoteRequest.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    ]);
    const counts: Record<QuoteRequestStatus, number> = { new: 0, contacted: 0, approved: 0, archived: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    return { items: items.map(view), counts };
  }

  async get(organizationId: string, id: string) {
    const q = await this.db.quoteRequest.findFirst({ where: { id, organizationId }, include: projectInclude });
    if (!q) throw new DomainError('not_found', 'Pedido não encontrado');
    return view(q);
  }

  /** A equipe muda a situação (novo → em conversa → arquivado) e anota. "Aprovado" só ao virar projeto. */
  async update(organizationId: string, id: string, patch: { status?: QuoteRequestStatus; notes?: string | null }, actor: Actor) {
    const before = await this.get(organizationId, id);
    if (patch.status === 'approved' && !before.projectId) throw new DomainError('validation', 'Para aprovar, use “Promover a projeto”');
    if (patch.status && patch.status !== 'approved' && before.projectId) throw new DomainError('conflict', 'Este orçamento já virou projeto');
    const notes = patch.notes !== undefined ? patch.notes?.trim() || null : before.notes;
    if (notes && notes.length > 4000) throw new DomainError('validation', 'As anotações devem ter até 4.000 caracteres');
    await this.db.$transaction(async (tx) => {
      await tx.quoteRequest.update({ where: { id }, data: { status: patch.status, notes } });
      await audit(tx, organizationId, actor, 'quote_request.update', 'quote_request', id, {
        before: { status: before.status, notes: before.notes },
        after: { status: patch.status ?? before.status, notes },
      });
    });
    return this.get(organizationId, id);
  }

  /** Antes de criar o projeto: o orçamento existe e ainda não virou projeto. */
  async assertPromotable(organizationId: string, id: string) {
    const q = await this.get(organizationId, id);
    if (q.projectId) throw new DomainError('conflict', 'Este orçamento já virou projeto', { code: 'quote_already_promoted', projectId: q.projectId });
    return q;
  }

  /** Liga o projeto criado ao orçamento, que passa a "aprovado". */
  async linkProject(organizationId: string, id: string, projectId: string, actor: Actor) {
    const q = await this.assertPromotable(organizationId, id);
    await this.db.$transaction(async (tx) => {
      await tx.quoteRequest.update({ where: { id }, data: { projectId, status: 'approved' } });
      await audit(tx, organizationId, actor, 'quote_request.promote', 'quote_request', id, { before: { status: q.status }, after: { status: 'approved', projectId } });
    });
    return this.get(organizationId, id);
  }
}

const projectInclude = { project: { select: { id: true, title: true } } } as const;

function view(q: {
  id: string;
  contactId: string | null;
  name: string;
  email: string;
  phone: string;
  segment: string;
  services: string[];
  description: string;
  neededBy: Date | null;
  status: QuoteRequestStatus;
  notes: string | null;
  source: string;
  projectId: string | null;
  project: { id: string; title: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const neededBy = q.neededBy ? toIsoDate(q.neededBy) : null;
  return { ...q, neededBy, projectDraft: projectDraftFromQuote({ ...q, neededBy }) };
}
