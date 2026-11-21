import { enqueueDelivery, type Prisma } from '@coxia/database';
import type { Tx } from './common';
import { escapeHtml, layout, type RenderedEmail } from './resident-emails';

/**
 * Avisos por e-mail para as administradoras (owner e admin com e-mail): lembretes, contas,
 * compromissos e pedidos de orçamento. Vão junto com o WhatsApp, não no lugar dele.
 */
export interface StaffNoticePayload {
  template: 'staff_notice';
  subject: string;
  /** Mesmo texto do WhatsApp (*negrito* vira <strong>). */
  text: string;
  /** Caminho no painel (ex.: /orcamentos), montado com a URL do Coxia na hora de enviar. */
  path?: string | null;
  actionLabel?: string | null;
  /** Responder o e-mail vai para esta pessoa (ex.: quem pediu o orçamento). */
  replyTo?: string | null;
}

/** E-mails das administradoras da organização (owner e admin). */
export async function adminEmails(db: Tx, organizationId: string): Promise<string[]> {
  const rows = await db.organizationMember.findMany({
    where: { organizationId, role: { in: ['owner', 'admin'] }, user: { email: { not: null } } },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(rows.map((r) => r.user.email!.trim().toLowerCase()).filter(Boolean))];
}

export async function enqueueStaffEmail(tx: Tx, organizationId: string, to: string, payload: StaffNoticePayload, idempotencyKey: string) {
  return enqueueDelivery(tx, {
    organizationId,
    recipient: to,
    text: payload.subject,
    idempotencyKey,
    channel: 'email',
    payload: payload as unknown as Prisma.InputJsonValue,
  });
}

const plain = (s: string) => s.replace(/\*([^*\n]+)\*/g, '$1');
const strong = (s: string) => escapeHtml(s).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');

export function renderStaffEmail(payload: StaffNoticePayload, ctx: { staffUrl: string }): RenderedEmail {
  const paragraphs = payload.text
    .split(/\n{2,}/)
    .map((block) => block.split('\n').map(strong).join('<br>'))
    .filter(Boolean);
  const url = payload.path ? `${ctx.staffUrl.replace(/\/$/, '')}${payload.path}` : null;
  // Os parágrafos já vão escapados (strong): layout() recebe HTML pronto.
  const html = layout(payload.subject, paragraphs, url ? { label: payload.actionLabel ?? 'Abrir no Coxia', url } : undefined, 'Coxia · Casa Kaju');
  return { subject: payload.subject, html, text: `${plain(payload.text)}${url ? `\n\n${url}` : ''}`, ...(payload.replyTo ? { replyTo: payload.replyTo } : {}) };
}
