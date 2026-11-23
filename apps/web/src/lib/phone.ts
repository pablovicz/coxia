/**
 * Validação do WhatsApp digitado (a API confere de novo). O campo usa o seletor de país e
 * entrega E.164 ("+55…"); Brasil precisa de DDD e número, os outros países 8 a 15 dígitos.
 */
export function phoneInputError(raw: string): string | null {
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');
  if (!value.startsWith('+') || digits.startsWith('55')) {
    const br = value.startsWith('+') ? digits.slice(2) : digits;
    return br.length === 10 || br.length === 11 ? null : 'Informe o WhatsApp com DDD.';
  }
  return digits.length >= 8 && digits.length <= 15 ? null : 'Número incompleto: confira o país e o número.';
}
