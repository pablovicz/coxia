/**
 * Mantém só dígitos (E.164 sem '+'). Retorna null para valores vazios e para o que não é telefone:
 * IDs @lid (identificador interno do WhatsApp, não é número) e IDs de grupo.
 * JIDs de pessoa (5511…@c.us, 5511…@s.whatsapp.net) viram o número.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  const at = value.indexOf('@');
  if (at >= 0) {
    const domain = value.slice(at + 1).toLowerCase();
    if (domain !== 'c.us' && domain !== 's.whatsapp.net') return null;
    value = value.slice(0, at);
  }
  if (isZapiGroupId(value)) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/** IDs de grupo da Z-API terminam em "-group" (ex.: 120363019502650977-group). */
export function isZapiGroupId(chatId: string): boolean {
  return chatId.endsWith('-group');
}

/**
 * Telefone digitado no painel → mesmo formato do WhatsApp (55 + DDD + número).
 * "11 98765-4321" e "(11) 3333-4444" ganham o 55; números já com DDI ficam como estão.
 */
export function normalizeBrPhone(raw: string | null | undefined): string | null {
  const digits = normalizePhone(raw);
  if (!digits) return null;
  // 10–11 dígitos = DDD + número; com "+" na frente, o usuário já informou o país.
  if ((digits.length === 10 || digits.length === 11) && !(raw ?? '').trim().startsWith('+')) return `55${digits}`;
  return digits;
}
