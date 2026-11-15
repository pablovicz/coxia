/** Salas cadastradas na Coxia que aparecem no site (sem preços). Buscadas no servidor do Next. */
export interface PublicSpace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  capacity: number | null;
  photos: Array<{ id: string; contentType: string }>;
}

/** Páginas com salas são regeradas a cada 5 minutos: sala nova aparece sozinha. */
export const SPACES_REVALIDATE = 300;

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export const photoUrl = (slug: string, photoId: string) => `${API_URL}/public/spaces/${encodeURIComponent(slug)}/photos/${encodeURIComponent(photoId)}`;

/** Lista das salas; se a api não responder, a página sai sem a seção (e tenta de novo na próxima regeração). */
export async function fetchSpaces(): Promise<PublicSpace[]> {
  try {
    const res = await fetch(`${API_URL}/public/spaces`, { next: { revalidate: SPACES_REVALIDATE } });
    if (!res.ok) return [];
    return (await res.json()) as PublicSpace[];
  } catch {
    return [];
  }
}

/**
 * Uma sala; null quando não existe (ou saiu do site). Falha da api lança erro em vez de virar 404:
 * o Next mantém a versão anterior da página em cache.
 */
export async function fetchSpace(slug: string): Promise<PublicSpace | null> {
  const res = await fetch(`${API_URL}/public/spaces/${encodeURIComponent(slug)}`, { next: { revalidate: SPACES_REVALIDATE } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`api ${res.status}`);
  return (await res.json()) as PublicSpace;
}

/** Primeira frase (ou trecho) da descrição, para cartões e metadados. */
export function summary(text: string | null, max = 160): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : clean;
}
