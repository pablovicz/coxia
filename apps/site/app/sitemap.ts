import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/content';
import { fetchSpaces } from '@/lib/spaces';

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rooms = await fetchSpaces();
  return [
    { url: `${SITE.url}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE.url}/orcamento`, changeFrequency: 'yearly', priority: 0.8 },
    ...rooms.map((r) => ({ url: `${SITE.url}/espacos/${r.slug}`, changeFrequency: 'weekly' as const, priority: 0.9 })),
  ];
}
