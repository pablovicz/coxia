import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { QuoteForm } from '@/components/quote-form';
import { SpaceGallery } from '@/components/space-gallery';
import { SITE } from '@/lib/content';
import { fetchSpace, fetchSpaces, photoUrl, summary } from '@/lib/spaces';

// Regerada a cada 5 minutos; sala nova (fora do build) é gerada no primeiro acesso.
export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await fetchSpaces()).map((s) => ({ slug: s.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const space = await fetchSpace((await params).slug);
  if (!space) return { title: 'Espaço não encontrado', robots: { index: false } };
  const description = summary(space.description) || `${space.name} na Casa Kaju: fotos e pedido de orçamento.`;
  const cover = space.photos[0] ? photoUrl(space.slug, space.photos[0].id) : '/og.jpg';
  return {
    title: space.name,
    description,
    alternates: { canonical: `/espacos/${space.slug}` },
    openGraph: { url: `/espacos/${space.slug}`, title: `${space.name} · Casa Kaju`, description, images: [{ url: cover, alt: space.name }] },
  };
}

export default async function SpacePage({ params }: Props) {
  const space = await fetchSpace((await params).slug);
  if (!space) notFound();
  const photos = space.photos.map((p) => ({ id: p.id, src: photoUrl(space.slug, p.id) }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: `${space.name} · Casa Kaju`,
    description: summary(space.description, 300) || undefined,
    url: `${SITE.url}/espacos/${space.slug}`,
    image: photos.map((p) => p.src),
    maximumAttendeeCapacity: space.capacity ?? undefined,
    containedInPlace: { '@type': 'LocalBusiness', name: SITE.name, url: SITE.url },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="scroll-mt-16 bg-kaju-green px-4 pb-14 pt-8 text-kaju-cream sm:px-6 sm:pt-12">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Você está em" className="mb-6 text-sm text-kaju-pink">
            <Link href="/" className="hover:underline">
              Início
            </Link>{' '}
            /{' '}
            <Link href="/#nossos-espacos" className="hover:underline">
              Espaços
            </Link>{' '}
            / <span aria-current="page">{space.name}</span>
          </nav>
          <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
            <SpaceGallery name={space.name} photos={photos} />
            <div>
              <h1 className="font-display text-4xl font-extrabold leading-tight text-kaju-pink sm:text-5xl">{space.name}</h1>
              {space.capacity ? <p className="mt-3 inline-flex rounded-full bg-kaju-pink px-4 py-1.5 text-sm font-bold text-kaju-green">Até {space.capacity} pessoas</p> : null}
              {space.description ? (
                <div className="mt-6 space-y-4 whitespace-pre-line text-[15px] leading-relaxed text-kaju-cream/90 sm:text-base">{space.description}</div>
              ) : (
                <p className="mt-6 text-kaju-cream/80">Fale com a gente para saber mais sobre este espaço.</p>
              )}
              <a href="#orcamento-titulo" className="btn btn-rose mt-8">
                Pedir orçamento
              </a>
            </div>
          </div>
        </div>
      </section>
      <section aria-label="Orçamento" className="bg-kaju-pink bg-[url(/img/padrao-azulejo.webp)] bg-size-[680px] bg-repeat px-4 py-12 sm:px-6 sm:py-16">
        <QuoteForm space={{ slug: space.slug, name: space.name }} />
      </section>
    </>
  );
}
