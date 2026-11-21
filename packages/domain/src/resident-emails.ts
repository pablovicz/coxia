import { enqueueDelivery, type Prisma } from '@coxia/database';
import { buildIcs } from '@coxia/shared';
import { DateTime } from 'luxon';
import type { Tx } from './common';

/**
 * E-mails do residente. O domínio só enfileira os dados (outbox, na mesma transação);
 * o worker monta assunto, HTML e o anexo .ics na hora de enviar — ele conhece a URL do workspace.
 */
export type ResidentEmailPayload =
  | {
      template: 'access';
      purpose: 'invite' | 'reset';
      residentName: string;
      organizationName: string;
      /** Token bruto do link (o banco guarda só o hash). O worker apaga daqui depois de enviar. */
      token: string;
    }
  | {
      template: 'booking';
      method: 'REQUEST' | 'CANCEL';
      occurrenceId: string;
      sequence: number;
      startAt: string;
      endAt: string;
      spaceName: string;
      residentName: string;
      organizationName: string;
      timezone: string;
    };

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
  replyTo?: string;
}

export async function enqueueResidentEmail(tx: Tx, organizationId: string, to: string, payload: ResidentEmailPayload, idempotencyKey: string) {
  return enqueueDelivery(tx, {
    organizationId,
    recipient: to,
    // Texto curto para o painel de entregas; o corpo de verdade sai do payload.
    text: payload.template === 'access' ? `Acesso ao workspace (${payload.purpose})` : `Reserva ${payload.method} ${payload.startAt}`,
    idempotencyKey,
    channel: 'email',
    payload: payload as unknown as Prisma.InputJsonValue,
  });
}

/**
 * Convites/cancelamentos por e-mail das ocorrências de reservas de contrato (uma por reserva).
 * Cancelamento e alteração sobem a SEQUENCE, para o calendário do residente atualizar o mesmo evento.
 * Ocorrências que não são de contrato (ou residente sem e-mail) são ignoradas.
 */
export async function enqueueBookingEmails(tx: Tx, occurrenceIds: string[], method: 'REQUEST' | 'CANCEL', opts: { bump?: boolean } = {}) {
  if (!occurrenceIds.length) return 0;
  const occs = await tx.bookingOccurrence.findMany({
    where: { id: { in: occurrenceIds }, booking: { contractId: { not: null } } },
    include: {
      space: { select: { name: true } },
      organization: { select: { name: true, timezone: true } },
      booking: { select: { contract: { select: { resident: { select: { name: true, email: true, account: { select: { email: true, status: true } } } } } } } },
    },
  });
  let count = 0;
  for (const o of occs) {
    const resident = o.booking.contract?.resident;
    const account = resident?.account;
    if (account?.status === 'disabled') continue;
    const to = account?.email ?? resident?.email;
    if (!resident || !to) continue;
    let sequence = o.inviteSequence;
    if (method === 'CANCEL' || opts.bump) {
      sequence += 1;
      await tx.bookingOccurrence.update({ where: { id: o.id }, data: { inviteSequence: sequence } });
    }
    await enqueueResidentEmail(
      tx,
      o.organizationId,
      to,
      {
        template: 'booking',
        method,
        occurrenceId: o.id,
        sequence,
        startAt: o.startAt.toISOString(),
        endAt: o.endAt.toISOString(),
        spaceName: o.space.name,
        residentName: resident.name,
        organizationName: o.organization.name,
        timezone: o.organization.timezone,
      },
      `booking_${method.toLowerCase()}:${o.id}:${sequence}`,
    );
    count++;
  }
  return count;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function layout(title: string, paragraphs: string[], cta?: { label: string; url: string }, footer = 'Casa Kaju · workspace do residente'): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#2f5d50;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#666">Ou copie o link: ${escapeHtml(cta.url)}</p>`
    : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f6f3ee;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px"><h1 style="font-size:20px;margin:0 0 20px">${escapeHtml(title)}</h1>${body}${button}<p style="margin:32px 0 0;font-size:12px;color:#888">${escapeHtml(footer)}</p></div></body></html>`;
}

/** Monta o e-mail a partir do payload do outbox. */
export function renderResidentEmail(payload: ResidentEmailPayload, ctx: { appUrl: string; fromEmail: string; fromName: string; to: string }, now = new Date()): RenderedEmail {
  const app = ctx.appUrl.replace(/\/$/, '');
  if (payload.template === 'access') {
    const url = `${app}/definir-senha?token=${encodeURIComponent(payload.token)}`;
    if (payload.purpose === 'invite') {
      const subject = `Seu acesso ao workspace da ${payload.organizationName}`;
      const lines = [
        `Olá, ${escapeHtml(payload.residentName)}!`,
        'A equipe da Casa Kaju criou o seu acesso ao workspace do residente. Por lá você reserva as salas do seu contrato, acompanha o saldo de horas, faz check-in e vê os pagamentos.',
        'Para começar, defina a sua senha (o link vale por 7 dias):',
      ];
      return { subject, html: layout(subject, lines, { label: 'Definir minha senha', url }), text: `${lines.join('\n\n')}\n\n${url}` };
    }
    const subject = 'Redefinir a senha do workspace';
    const lines = [`Olá, ${escapeHtml(payload.residentName)}!`, 'Recebemos um pedido para redefinir a sua senha. O link vale por 1 hora. Se não foi você, ignore este e-mail.'];
    return { subject, html: layout(subject, lines, { label: 'Redefinir senha', url }), text: `${lines.join('\n\n')}\n\n${url}` };
  }

  const start = DateTime.fromISO(payload.startAt, { zone: payload.timezone }).setLocale('pt-BR');
  const end = DateTime.fromISO(payload.endAt, { zone: payload.timezone }).setLocale('pt-BR');
  const when = `${start.toFormat("cccc, dd 'de' LLLL")} · ${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}`;
  const checkInUrl = `${app}/reservas/${payload.occurrenceId}/check-in`;
  const cancelled = payload.method === 'CANCEL';
  const subject = cancelled ? `Reserva cancelada: ${payload.spaceName} · ${start.toFormat('dd/MM HH:mm')}` : `Reserva confirmada: ${payload.spaceName} · ${start.toFormat('dd/MM HH:mm')}`;
  const lines = cancelled
    ? [`A sua reserva da <strong>${escapeHtml(payload.spaceName)}</strong> em ${escapeHtml(when)} foi cancelada. As horas voltaram para o seu saldo.`]
    : [
        `Sua reserva da <strong>${escapeHtml(payload.spaceName)}</strong> está confirmada: ${escapeHtml(when)}.`,
        'Ao chegar, faça o check-in pelo link abaixo (ou pelo QR code da sala). O check-in abre 15 minutos antes do horário. As horas da reserva saem do seu saldo, com ou sem check-in.',
      ];
  const ics = buildIcs({
    uid: `${payload.occurrenceId}@casakaju.com`,
    method: payload.method,
    sequence: payload.sequence,
    startAt: new Date(payload.startAt),
    endAt: new Date(payload.endAt),
    summary: `${payload.spaceName} — ${payload.organizationName}`,
    description: cancelled ? 'Reserva cancelada.' : `Check-in: ${checkInUrl}`,
    location: `${payload.organizationName} · ${payload.spaceName}`,
    url: cancelled ? undefined : checkInUrl,
    organizer: { name: ctx.fromName, email: ctx.fromEmail },
    attendee: { name: payload.residentName, email: ctx.to },
    now,
  });
  return {
    subject,
    html: layout(subject, lines, cancelled ? undefined : { label: 'Fazer check-in', url: checkInUrl }),
    text: `${lines.join('\n\n').replace(/<[^>]+>/g, '')}${cancelled ? '' : `\n\nCheck-in: ${checkInUrl}`}`,
    attachments: [{ filename: cancelled ? 'cancelamento.ics' : 'reserva.ics', content: ics, contentType: `text/calendar; charset=utf-8; method=${payload.method}` }],
  };
}
