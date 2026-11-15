import { SEGMENTS, SERVICES, type SegmentKey, type ServiceKey } from './content';

export interface QuotePayload {
  name: string;
  email: string;
  phone: string;
  segment: SegmentKey;
  services: ServiceKey[];
  description: string;
  neededBy: string | null;
  /** Armadilha para robôs: fica escondida e vazia. */
  website: string;
}

export type QuoteErrors = Partial<Record<'name' | 'email' | 'phone' | 'segment' | 'services' | 'description', string>>;

const digits = (s: string) => s.replace(/\D/g, '');

/** Monta o envio a partir do formulário e confere o que a api também confere. */
export function readQuoteForm(form: FormData): { payload: QuotePayload; errors: QuoteErrors } {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const segment = str('segment') as SegmentKey;
  const services = form.getAll('services').map(String) as ServiceKey[];
  const payload: QuotePayload = {
    name: str('name'),
    email: str('email'),
    phone: str('phone'),
    segment,
    services,
    description: str('description'),
    neededBy: str('neededBy') || null,
    website: str('website'),
  };
  const errors: QuoteErrors = {};
  if (payload.name.length < 2) errors.name = 'Informe seu nome.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) errors.email = 'Informe um e-mail válido.';
  const d = digits(payload.phone);
  if (d.length < 10 || d.length > 13) errors.phone = 'Informe o WhatsApp com DDD.';
  if (!SEGMENTS.some((s) => s.key === segment)) errors.segment = 'Escolha o segmento.';
  if (!services.length || !services.every((s) => SERVICES.some((x) => x.key === s))) errors.services = 'Escolha pelo menos um serviço.';
  if (payload.description.length < 10) errors.description = 'Conte um pouco sobre o projeto (pelo menos uma frase).';
  return { payload, errors };
}

/** Máscara leve para o WhatsApp brasileiro: (41) 99907-1145. */
export function maskPhone(raw: string): string {
  const d = digits(raw).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
