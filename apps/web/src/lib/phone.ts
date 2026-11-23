/**
 * Validação do WhatsApp digitado (a API confere de novo). Padrão BR: sem "+", precisa de DDD
 * e número. Com "+" e o código do país, aceita número de qualquer lugar (8 a 15 dígitos).
 */
export function phoneInputError(raw: string): string | null {
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? null : 'Número internacional inválido: use + o código do país e o número.';
  return digits.length >= 10 && digits.length <= 13 ? null : 'Informe o WhatsApp com DDD (ou + e o código do país, se for de fora).';
}

export const PHONE_HINT = 'Do Brasil: DDD e número. De fora: + e o código do país, ex.: +351 912 345 678';
