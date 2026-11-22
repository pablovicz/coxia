import type { ResidentStatus } from '@coxia/database';
import { addDays, localDateOf, normalizeBrPhone, normalizeText } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError, getOrganization, toIsoDate, type Tx } from './common';

export interface ResidentInput {
  name: string;
  /** WhatsApp: liga o residente ao contato (reservas e pagamentos). */
  phone: string;
  description?: string | null;
  /** "@xpo", "xpo" ou o link do perfil: guardado sem o @. */
  instagram?: string | null;
  email?: string | null;
  status?: ResidentStatus;
  paymentDay?: number | null;
}

/** Situação pelos pagamentos (entradas ligadas ao residente). */
export type ResidentSituation = 'pending' | 'regular' | 'attention' | 'overdue';

/** Vencendo em até tantos dias: "atenção". */
const ATTENTION_DAYS = 5;

const WEEKDAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

type IncomeLike = { status: string; expectedOn: Date; receivedOn: Date | null };

/**
 * - pagamento atrasado: tem entrada prevista que já venceu;
 * - atenção: tem entrada prevista vencendo nos próximos dias;
 * - regular: já pagou e nada está vencido;
 * - pendente: nenhum pagamento registrado ainda.
 */
export function residentSituation(incomes: IncomeLike[], today: string): ResidentSituation {
  const open = incomes.filter((i) => i.status === 'expected');
  if (open.some((i) => toIsoDate(i.expectedOn) < today)) return 'overdue';
  if (open.some((i) => toIsoDate(i.expectedOn) <= addDays(today, ATTENTION_DAYS))) return 'attention';
  if (incomes.some((i) => i.status === 'received')) return 'regular';
  return 'pending';
}

export function normalizeInstagram(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const handle = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) throw new DomainError('validation', 'Instagram inválido (use @usuario)');
  return handle;
}

const residentInclude = {
  contact: { select: { id: true, phone: true, name: true, whatsappName: true, photoUrl: true } },
} as const;

/** Garante o cadastro de residente para um contato (reserva recorrente faz do contato um residente). */
export async function ensureResident(tx: Tx, organizationId: string, contactId: string) {
  const existing = await tx.resident.findUnique({ where: { contactId } });
  if (existing) return existing;
  const contact = await tx.contact.findUniqueOrThrow({ where: { id: contactId } });
  return tx.resident.create({ data: { organizationId, contactId, name: contact.name ?? contact.whatsappName ?? contact.phone } });
}

export class ResidentService {
  constructor(private readonly db: Db) {}

  /** Lista com a situação, as salas que ocupa e o dia de pagamento. */
  async list(organizationId: string, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const today = localDateOf(now, org.timezone);
    const residents = await this.db.resident.findMany({ where: { organizationId }, include: residentInclude, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    const contactIds = residents.map((r) => r.contactId);
    const [incomes, bookings] = await Promise.all([
      this.db.income.findMany({ where: { organizationId, contactId: { in: contactIds }, status: { not: 'cancelled' } }, select: { contactId: true, status: true, expectedOn: true, receivedOn: true } }),
      this.activeSeries(organizationId, contactIds, today),
    ]);
    return residents.map((r) => {
      const mine = incomes.filter((i) => i.contactId === r.contactId);
      const rooms = new Map<string, { id: string; name: string; color: string; icon: string }>();
      for (const b of bookings.filter((x) => x.contactId === r.contactId)) rooms.set(b.space.id, b.space);
      return { ...r, situation: residentSituation(mine, today), rooms: [...rooms.values()] };
    });
  }

  async get(organizationId: string, id: string) {
    const r = await this.db.resident.findFirst({ where: { id, organizationId }, include: residentInclude });
    if (!r) throw new DomainError('not_found', 'Residente não encontrado');
    return r;
  }

  /**
   * Detalhe: locações (cada sala, com a programação de dias e horários), pagamentos por mês,
   * entrada (primeiro mês pago) e dias de pagamento (o combinado e os de fato).
   */
  async details(organizationId: string, id: string, now = new Date()) {
    const org = await getOrganization(this.db, organizationId);
    const today = localDateOf(now, org.timezone);
    const resident = await this.get(organizationId, id);
    const [incomes, series] = await Promise.all([
      this.db.income.findMany({
        where: { organizationId, contactId: resident.contactId, status: { not: 'cancelled' } },
        include: { space: { select: { id: true, name: true } } },
        orderBy: { expectedOn: 'asc' },
      }),
      this.activeSeries(organizationId, [resident.contactId], today),
    ]);

    // Locações: uma por sala; a programação junta as séries (um horário por série).
    const rentals = new Map<string, { space: { id: string; name: string; color: string; icon: string }; schedule: Array<{ bookingId: string; title: string | null; weekdays: string[]; start: string; end: string; since: string | null; until: string | null; hourlyRateCents: number | null }> }>();
    for (const b of series) {
      const days = /BYDAY=([A-Z,]+)/.exec(b.recurrenceRule ?? '')?.[1]?.split(',') ?? [];
      const entry = rentals.get(b.space.id) ?? { space: b.space, schedule: [] };
      entry.schedule.push({
        bookingId: b.id,
        title: b.title,
        weekdays: days.sort((x, y) => WEEKDAY_ORDER.indexOf(x) - WEEKDAY_ORDER.indexOf(y)),
        start: b.localStartTime ?? '',
        end: b.localEndTime ?? '',
        since: b.seriesStartsOn ? toIsoDate(b.seriesStartsOn) : null,
        until: b.seriesUntil ? toIsoDate(b.seriesUntil) : null,
        hourlyRateCents: b.hourlyRateCents,
      });
      rentals.set(b.space.id, entry);
    }

    const received = incomes.filter((i) => i.status === 'received' && i.receivedOn);
    const payments = incomes.map((i) => ({
      id: i.id,
      month: toIsoDate(i.receivedOn ?? i.expectedOn).slice(0, 7),
      description: i.description,
      status: i.status,
      expectedOn: toIsoDate(i.expectedOn),
      receivedOn: i.receivedOn ? toIsoDate(i.receivedOn) : null,
      amountCents: i.status === 'received' ? (i.receivedAmountCents ?? i.amountCents) : i.amountCents,
      overdue: i.status === 'expected' && toIsoDate(i.expectedOn) < today,
      space: i.space,
    }));
    const firstPaid = received.length ? toIsoDate(received.map((i) => i.receivedOn!).sort((a, b) => a.getTime() - b.getTime())[0]!) : null;
    const paidDays = [...new Set(received.map((i) => Number(toIsoDate(i.receivedOn!).slice(8, 10))))].sort((a, b) => a - b);

    return {
      resident,
      situation: residentSituation(incomes, today),
      rentals: [...rentals.values()],
      payments: payments.reverse(),
      totals: {
        receivedCents: payments.filter((p) => p.status === 'received').reduce((s, p) => s + p.amountCents, 0),
        openCents: payments.filter((p) => p.status === 'expected').reduce((s, p) => s + p.amountCents, 0),
      },
      firstPaymentMonth: firstPaid ? firstPaid.slice(0, 7) : null,
      paymentDays: { agreed: resident.paymentDay, observed: paidDays },
    };
  }

  async create(organizationId: string, input: ResidentInput, actor: Actor) {
    const data = this.validate(input);
    const phone = this.phoneOf(input.phone);
    return this.db.$transaction(async (tx) => {
      const contact = await this.contactFor(tx, organizationId, phone, data.name);
      if (await tx.resident.findUnique({ where: { contactId: contact.id } })) {
        throw new DomainError('conflict', 'Este WhatsApp já é de um residente', { code: 'already_resident' });
      }
      const created = await tx.resident.create({ data: { organizationId, contactId: contact.id, ...data }, include: residentInclude });
      await audit(tx, organizationId, actor, 'resident.create', 'resident', created.id, { after: created });
      return created;
    });
  }

  async update(organizationId: string, id: string, patch: Partial<ResidentInput>, actor: Actor) {
    const before = await this.get(organizationId, id);
    const data = this.validate({ name: before.name, phone: before.contact.phone, ...patch }, patch);
    return this.db.$transaction(async (tx) => {
      let contactId = before.contactId;
      // Trocou o WhatsApp: passa a ser outro contato (reservas e pagamentos vêm dele).
      if (patch.phone !== undefined) {
        const phone = this.phoneOf(patch.phone);
        if (phone !== before.contact.phone) {
          const contact = await this.contactFor(tx, organizationId, phone, data.name ?? before.name);
          const other = await tx.resident.findUnique({ where: { contactId: contact.id } });
          if (other && other.id !== id) throw new DomainError('conflict', 'Este WhatsApp já é de outro residente', { code: 'already_resident' });
          contactId = contact.id;
        }
      }
      const updated = await tx.resident.update({ where: { id }, data: { ...data, contactId }, include: residentInclude });
      await audit(tx, organizationId, actor, 'resident.update', 'resident', id, { before, after: updated });
      return updated;
    });
  }

  /** Foto e contrato: a api guarda o arquivo; aqui só a referência (devolve a anterior para apagar). */
  async setFile(organizationId: string, id: string, kind: 'photo' | 'contract', file: { key: string; contentType: string; fileName?: string | null } | null, actor: Actor) {
    const before = await this.get(organizationId, id);
    const now = new Date();
    const data =
      kind === 'photo'
        ? { photoKey: file?.key ?? null, photoContentType: file?.contentType ?? null, photoUpdatedAt: file ? now : null }
        : { contractKey: file?.key ?? null, contractContentType: file?.contentType ?? null, contractFileName: file?.fileName ?? null, contractUploadedAt: file ? now : null };
    await this.db.$transaction(async (tx) => {
      await tx.resident.update({ where: { id }, data });
      await audit(tx, organizationId, actor, `resident.${kind}_${file ? 'set' : 'removed'}`, 'resident', id);
    });
    return { previousKey: kind === 'photo' ? before.photoKey : before.contractKey };
  }

  // ───────────── internos ─────────────

  private activeSeries(organizationId: string, contactIds: string[], today: string) {
    return this.db.booking.findMany({
      where: {
        organizationId,
        contactId: { in: contactIds },
        recurrenceRule: { not: null },
        status: { not: 'cancelled' },
        OR: [{ seriesUntil: null }, { seriesUntil: { gte: new Date(`${today}T00:00:00Z`) } }],
      },
      include: { space: { select: { id: true, name: true, color: true, icon: true } } },
      orderBy: [{ space: { sortOrder: 'asc' } }, { localStartTime: 'asc' }],
    });
  }

  private phoneOf(raw: string) {
    const phone = normalizeBrPhone(raw);
    if (!phone || phone.length < 12 || phone.length > 15) throw new DomainError('validation', 'WhatsApp inválido');
    return phone;
  }

  private async contactFor(tx: Tx, organizationId: string, phone: string, name: string) {
    const existing = await tx.contact.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
    if (existing) {
      return tx.contact.update({
        where: { id: existing.id },
        data: { kind: 'resident', ...(existing.name ? {} : { name, searchName: normalizeText([name, existing.whatsappName].filter(Boolean).join(' ')) }) },
      });
    }
    return tx.contact.create({ data: { organizationId, phone, name, kind: 'resident', searchName: normalizeText(name) } });
  }

  private validate(input: ResidentInput, only?: Partial<ResidentInput>) {
    const pick = <K extends keyof ResidentInput>(k: K) => only === undefined || only[k] !== undefined;
    const name = input.name?.trim();
    if (pick('name') && !name) throw new DomainError('validation', 'Informe o nome do residente');
    const email = input.email?.trim() || null;
    // E-mail é o login do workspace do residente: obrigatório no cadastro e não pode ser apagado.
    if (pick('email') && !email) throw new DomainError('validation', 'Informe o e-mail do residente (é o login do workspace)', { code: 'email_required' });
    if (pick('email') && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('validation', 'E-mail inválido');
    if (pick('paymentDay') && input.paymentDay != null && (!Number.isInteger(input.paymentDay) || input.paymentDay < 1 || input.paymentDay > 31)) {
      throw new DomainError('validation', 'Dia de pagamento entre 1 e 31');
    }
    return {
      ...(pick('name') ? { name: name! } : {}),
      ...(pick('description') ? { description: input.description?.trim() || null } : {}),
      ...(pick('instagram') ? { instagram: normalizeInstagram(input.instagram) } : {}),
      ...(pick('email') ? { email } : {}),
      ...(pick('status') && input.status ? { status: input.status } : {}),
      ...(pick('paymentDay') ? { paymentDay: input.paymentDay ?? null } : {}),
    } as { name: string; description?: string | null; instagram?: string | null; email?: string | null; status?: ResidentStatus; paymentDay?: number | null };
  }
}
