/** Mantém só dígitos (E.164 sem '+'). Retorna null para valores vazios. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/** IDs de grupo da Z-API terminam em "-group" (ex.: 120363019502650977-group). */
export function isZapiGroupId(chatId: string): boolean {
  return chatId.endsWith('-group');
}
