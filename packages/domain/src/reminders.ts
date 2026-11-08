import type { ReminderType } from '@coxia/database';
import { addDays, expandDates, localDateOf, normalizeBrPhone, parseRRule, zonedToUtc } from '@coxia/shared';
import { DateTime } from 'luxon';
import { type Actor, audit, type Db, DomainError, getOrganization, type Tx } from './common';

export interface ReminderInput {
  /** Geral (padrão), ligar ou mandar mensagem para alguém. */
  type?: ReminderType;
  /** Opcional em ligar/mensagem: vira "Ligar para Carla". */
  title?: string | null;
  message?: string | null;
  /** Primeira execução (instante). */
  dueAt: Date;
  /** RRULE semanal/mensal; ausente = lembrete único. */
  recurrenceRule?: string | null;
  recipientPhones: string[];
  /** Para quem ligar/mandar mensagem: contato cadastrado ou nome/telefone digitados. */
  contactId?: string | null;
  personName?: string | null;
  personPhone?: string | null;
}

const reminderInclude = { contact: { select: { id: true, name: true, whatsappName: true, phone: true } } } as const;

/** Pessoa do lembrete: o contato (nome dado pela equipe, senão o do WhatsApp) ou o que foi digitado. */
export function reminderPerson(r: {
  personName: string | null;
  personPhone: string | null;
  contact: { name: string | null; whatsappName: string | null; phone: string } | null;
}): { name: string | null; phone: string | null } {
  if (r.contact) return { name: r.contact.name ?? r.contact.whatsappName ?? r.personName, phone: r.contact.phone };
  return { name: r.personName, phone: r.personPhone };
}

/** "+55 11 98765-4321" para o texto do WhatsApp (o app transforma em link de ligação). */
function phoneText(digits: string): string {
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${digits}`;
}

/** Texto enviado pelo WhatsApp quando o lembrete dispara. */
export function reminderText(r: {
  type: ReminderType;
  title: string;
  message: string | null;
  person: { name: string | null; phone: string | null };
}): string {
  const lines = [`⏰ Lembrete: ${r.title}`];
  if (r.type !== 'general' && (r.person.name || r.person.phone)) {
    const who = [r.person.name, r.person.phone ? phoneText(r.person.phone) : null].filter(Boolean).join(' · ');
    lines.push(`${r.type === 'call' ? 'Ligar para' : 'Mandar mensagem para'}: ${who}`);
    if (r.type === 'message' && r.person.phone) lines.push(`https://wa.me/${r.person.phone}`);
  }
  if (r.message) lines.push(r.message);
  return lines.join('\n');
}

/**
 * Próxima execução de um lembrete recorrente depois de `after`, mantendo o horário local da
 * primeira execução. Retorna null se a regra terminou.
 */
export function nextReminderRun(rule: string, firstRun: Date, after: Date, timezone: string): Date | null {
  const parsed = parseRRule(rule);
  const startDate = localDateOf(firstRun, timezone);
  const time = DateTime.fromJSDate(firstRun, { zone: timezone }).toFormat('HH:mm');
  const fromDate = localDateOf(after, timezone);
  for (const date of expandDates(parsed, startDate, fromDate, addDays(fromDate, 400))) {
    const run = zonedToUtc(date, time, timezone);
    if (run > after) return run;
  }
  return null;
}

export class ReminderService {
  constructor(private readonly db: Db) {}

  list(organizationId: string) {
    return this.db.reminder.findMany({
      where: { organizationId },
      include: reminderInclude,
      orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }, { lastSentAt: 'desc' }],
    });
  }

  async create(organizationId: string, input: ReminderInput, actor: Actor) {
    const type = input.type ?? 'general';
    const recipientPhones = [...new Set(input.recipientPhones.map((p) => normalizeBrPhone(p)).filter((p): p is string => !!p))];
    if (recipientPhones.length === 0) throw new DomainError('validation', 'Informe ao menos um destinatário');
    let personName = input.personName?.trim() || null;
    const personPhone = input.personPhone ? normalizeBrPhone(input.personPhone) : null;
    if (input.personPhone && (!personPhone || personPhone.length < 10)) throw new DomainError('validation', 'Telefone da pessoa inválido');
    const contact = input.contactId
      ? await this.db.contact.findFirst({ where: { id: input.contactId, organizationId }, select: { id: true, name: true, whatsappName: true, phone: true } })
      : null;
    if (input.contactId && !contact) throw new DomainError('not_found', 'Contato não encontrado');
    if (contact) personName = null;
    const who = contact ? (contact.name ?? contact.whatsappName ?? phoneText(contact.phone)) : (personName ?? (personPhone ? phoneText(personPhone) : null));
    if (type !== 'general' && !who) {
      throw new DomainError('validation', type === 'call' ? 'Para quem é a ligação?' : 'Para quem é a mensagem?');
    }
    const title = input.title?.trim() || (type === 'call' ? `Ligar para ${who}` : type === 'message' ? `Mandar mensagem para ${who}` : '');
    if (!title) throw new DomainError('validation', 'Informe o título do lembrete');
    if (input.recurrenceRule) {
      try {
        parseRRule(input.recurrenceRule);
      } catch (e) {
        throw new DomainError('validation', `Recorrência inválida: ${(e as Error).message}`);
      }
    }
    return this.db.$transaction(async (tx) => {
      const reminder = await tx.reminder.create({
        data: {
          organizationId,
          kind: input.recurrenceRule ? 'recurring' : 'one_time',
          type,
          title,
          message: input.message?.trim() || null,
          dueAt: input.dueAt,
          recurrenceRule: input.recurrenceRule ?? null,
          nextRunAt: input.dueAt,
          recipientPhones,
          contactId: contact?.id ?? null,
          personName,
          personPhone: contact ? null : personPhone,
          createdByUserId: actor.userId ?? null,
        },
        include: reminderInclude,
      });
      await audit(tx, organizationId, actor, 'reminder.create', 'reminder', reminder.id, { after: reminder });
      return reminder;
    });
  }

  async deactivate(organizationId: string, reminderId: string, actor: Actor) {
    const r = await this.db.reminder.findFirst({ where: { id: reminderId, organizationId } });
    if (!r) throw new DomainError('not_found', 'Lembrete não encontrado');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.reminder.update({ where: { id: reminderId }, data: { active: false, nextRunAt: null } });
      await audit(tx, organizationId, actor, 'reminder.deactivate', 'reminder', reminderId);
      return updated;
    });
  }

  due(organizationId: string, now: Date) {
    return this.db.reminder.findMany({ where: { organizationId, active: true, nextRunAt: { lte: now } }, include: reminderInclude });
  }

  /**
   * Lembretes automáticos das contas: as contas ativas já avisam sozinhas (véspera, dia do
   * vencimento e reavisos enquanto atrasadas, até serem pagas). Aqui eles aparecem como lembretes,
   * com a próxima conta em aberto de cada uma e quem recebe.
   */
  async automaticFromBills(organizationId: string) {
    const bills = await this.db.recurringBill.findMany({
      where: { organizationId, active: true },
      include: {
        occurrences: {
          where: { status: { in: ['pending', 'partially_paid', 'overdue'] } },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
      },
      orderBy: { dueDay: 'asc' },
    });
    const phones = [...new Set(bills.flatMap((b) => b.recipientPhones))];
    const members = phones.length
      ? await this.db.organizationMember.findMany({
          where: { organizationId, user: { phone: { in: phones } } },
          select: { user: { select: { name: true, phone: true } } },
        })
      : [];
    const nameOf = new Map(members.map((m) => [m.user.phone!, m.user.name]));
    return bills.map((b) => {
      const next = b.occurrences[0] ?? null;
      return {
        billId: b.id,
        name: b.name,
        dueDay: b.dueDay,
        isVariableAmount: b.isVariableAmount,
        overdueEveryDays: b.overdueReminderEveryDays,
        next: next
          ? {
              occurrenceId: next.id,
              dueDate: next.dueDate.toISOString().slice(0, 10),
              status: next.status,
              remainingCents: next.expectedAmountCents === null ? null : Math.max(next.expectedAmountCents - next.paidAmountCents, 0),
            }
          : null,
        recipients: b.recipientPhones.map((phone) => ({ phone, name: nameOf.get(phone) ?? null })),
      };
    });
  }

  /** Após enviar: único → desativa; recorrente → agenda o próximo. */
  async advance(tx: Tx, organizationId: string, reminderId: string, sentAt: Date) {
    const org = await getOrganization(tx, organizationId);
    const r = await tx.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    const next = r.recurrenceRule && r.dueAt ? nextReminderRun(r.recurrenceRule, r.dueAt, sentAt, org.timezone) : null;
    await tx.reminder.update({
      where: { id: reminderId },
      data: { lastSentAt: sentAt, nextRunAt: next, active: next !== null },
    });
  }
}
