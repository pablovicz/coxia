import type { AppointmentKind } from '@coxia/database';
import { normalizeBrPhone } from '@coxia/shared';
import { type Actor, audit, type Db, DomainError } from './common';

export const APPOINTMENT_KINDS: AppointmentKind[] = ['meeting', 'visit', 'event', 'other'];
export const APPOINTMENT_KIND_LABEL: Record<AppointmentKind, string> = {
  meeting: 'Reunião',
  visit: 'Visita',
  event: 'Evento',
  other: 'Compromisso',
};

export interface AppointmentInput {
  kind?: AppointmentKind;
  title: string;
  location?: string | null;
  notes?: string | null;
  startAt: Date;
  endAt: Date;
  /** Vai toda a equipe; senão, só quem estiver em `memberIds`. */
  allTeam?: boolean;
  memberIds?: string[];
  contactIds?: string[];
  /** Pessoas de fora: nome obrigatório, telefone opcional. */
  guests?: Array<{ name: string; phone?: string | null }>;
  /** Aviso pelo WhatsApp para a equipe participante; null = sem aviso. */
  notifyMinutesBefore?: number | null;
}

export const appointmentInclude = {
  participants: {
    include: {
      member: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
      contact: { select: { id: true, name: true, whatsappName: true, phone: true } },
    },
  },
} as const;

/** Até 1 semana de antecedência no aviso. */
const MAX_NOTICE_MINUTES = 7 * 24 * 60;

export class AppointmentService {
  constructor(private readonly db: Db) {}

  /** Compromissos que encostam em [from, to), sem os cancelados. */
  list(organizationId: string, from: Date, to: Date) {
    return this.db.appointment.findMany({
      where: { organizationId, status: 'scheduled', startAt: { lt: to }, endAt: { gt: from } },
      include: appointmentInclude,
      orderBy: { startAt: 'asc' },
    });
  }

  async get(organizationId: string, id: string) {
    const a = await this.db.appointment.findFirst({ where: { id, organizationId }, include: appointmentInclude });
    if (!a) throw new DomainError('not_found', 'Compromisso não encontrado');
    return a;
  }

  async create(organizationId: string, input: AppointmentInput, actor: Actor) {
    const data = await this.validate(organizationId, input);
    return this.db.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          organizationId,
          kind: data.kind,
          title: data.title,
          location: data.location,
          notes: data.notes,
          startAt: input.startAt,
          endAt: input.endAt,
          allTeam: data.allTeam,
          notifyMinutesBefore: data.notifyMinutesBefore,
          createdByUserId: actor.userId ?? null,
          participants: { create: data.participants },
        },
        include: appointmentInclude,
      });
      await audit(tx, organizationId, actor, 'appointment.create', 'appointment', created.id, { after: created });
      return created;
    });
  }

  /** Edição completa: os participantes são substituídos pelos informados. */
  async update(organizationId: string, id: string, input: AppointmentInput, actor: Actor) {
    const before = await this.get(organizationId, id);
    if (before.status === 'cancelled') throw new DomainError('conflict', 'Compromisso cancelado não pode ser editado');
    const data = await this.validate(organizationId, input);
    return this.db.$transaction(async (tx) => {
      await tx.appointmentParticipant.deleteMany({ where: { appointmentId: id } });
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          kind: data.kind,
          title: data.title,
          location: data.location,
          notes: data.notes,
          startAt: input.startAt,
          endAt: input.endAt,
          allTeam: data.allTeam,
          notifyMinutesBefore: data.notifyMinutesBefore,
          participants: { create: data.participants },
        },
        include: appointmentInclude,
      });
      await audit(tx, organizationId, actor, 'appointment.update', 'appointment', id, { before, after: updated });
      return updated;
    });
  }

  async cancel(organizationId: string, id: string, actor: Actor) {
    const before = await this.get(organizationId, id);
    if (before.status === 'cancelled') return before;
    return this.db.$transaction(async (tx) => {
      const updated = await tx.appointment.update({ where: { id }, data: { status: 'cancelled' }, include: appointmentInclude });
      await audit(tx, organizationId, actor, 'appointment.cancel', 'appointment', id);
      return updated;
    });
  }

  /**
   * Telefones da equipe que vai ao compromisso (toda a equipe ou os participantes da equipe).
   * Contatos e pessoas de fora não recebem aviso automático.
   */
  async teamPhones(organizationId: string, a: { allTeam: boolean; participants: Array<{ member: { user: { phone: string | null } } | null }> }) {
    if (a.allTeam) {
      const members = await this.db.organizationMember.findMany({
        where: { organizationId, user: { phone: { not: null } } },
        select: { user: { select: { phone: true } } },
      });
      return [...new Set(members.map((m) => m.user.phone!))];
    }
    return [...new Set(a.participants.map((p) => p.member?.user.phone).filter((p): p is string => !!p))];
  }

  private async validate(organizationId: string, input: AppointmentInput) {
    const title = input.title?.trim();
    if (!title) throw new DomainError('validation', 'Informe o título do compromisso');
    if (!(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime()) || Number.isNaN(input.endAt.getTime())) {
      throw new DomainError('validation', 'Informe data e horário');
    }
    if (input.endAt <= input.startAt) throw new DomainError('validation', 'O fim precisa ser depois do início');
    if (input.endAt.getTime() - input.startAt.getTime() > 14 * 24 * 3_600_000) {
      throw new DomainError('validation', 'Compromisso muito longo (máximo de 14 dias)');
    }
    const kind = input.kind ?? 'meeting';
    if (!APPOINTMENT_KINDS.includes(kind)) throw new DomainError('validation', 'Tipo de compromisso inválido');
    const notify = input.notifyMinutesBefore === undefined ? 60 : input.notifyMinutesBefore;
    if (notify !== null && (!Number.isInteger(notify) || notify < 0 || notify > MAX_NOTICE_MINUTES)) {
      throw new DomainError('validation', 'Antecedência do aviso inválida');
    }

    const allTeam = !!input.allTeam;
    const memberIds = allTeam ? [] : [...new Set(input.memberIds ?? [])];
    if (!allTeam && memberIds.length === 0) throw new DomainError('validation', 'Escolha quem da equipe vai (ou toda a equipe)');
    if (memberIds.length) {
      const found = await this.db.organizationMember.count({ where: { organizationId, id: { in: memberIds } } });
      if (found !== memberIds.length) throw new DomainError('not_found', 'Pessoa da equipe não encontrada');
    }
    const contactIds = [...new Set(input.contactIds ?? [])];
    if (contactIds.length) {
      const found = await this.db.contact.count({ where: { organizationId, id: { in: contactIds } } });
      if (found !== contactIds.length) throw new DomainError('not_found', 'Contato não encontrado');
    }
    const guests = (input.guests ?? []).map((g) => {
      const name = g.name?.trim();
      if (!name) throw new DomainError('validation', 'Informe o nome de cada pessoa de fora');
      const phone = g.phone?.trim() ? normalizeBrPhone(g.phone) : null;
      if (g.phone?.trim() && (!phone || phone.length < 10)) throw new DomainError('validation', `Telefone inválido para ${name}`);
      return { name, phone };
    });

    return {
      kind,
      title,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      allTeam,
      notifyMinutesBefore: notify,
      participants: [
        ...memberIds.map((memberId) => ({ memberId })),
        ...contactIds.map((contactId) => ({ contactId })),
        ...guests.map((g) => ({ name: g.name, phone: g.phone })),
      ],
    };
  }
}
