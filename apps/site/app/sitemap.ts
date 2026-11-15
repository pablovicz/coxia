import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/content';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE.url}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE.url}/orcamento/`, changeFrequency: 'yearly', priority: 0.8 },
  ];
}
