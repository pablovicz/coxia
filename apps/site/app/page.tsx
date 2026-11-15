import Image from 'next/image';
import Link from 'next/link';
import { InstagramIcon } from '@/components/chrome';
import { COURSES, quoteHref, SITE, SPACES } from '@/lib/content';
import { fetchSpaces, photoUrl, summary } from '@/lib/spaces';

// Salas cadastradas na Coxia: a home é regerada a cada 5 minutos.
export const revalidate = 300;

/** Dados estruturados para o Google (negócio local, com contatos e redes). */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: SITE.name,
  url: SITE.url,
  logo: `${SITE.url}/img/kaju-marca.webp`,
  image: `${SITE.url}/og.jpg`,
  description: SITE.description,
  slogan: SITE.tagline,
  telephone: `+${SITE.whatsapp}`,
  email: SITE.email,
  sameAs: [SITE.instagram],
};

const DESIGN_SERVICES = ['Figurino', 'Cenografia', 'Iluminação', 'Adereços', 'Bonecos'];

export default async function HomePage() {
  const rooms = await fetchSpaces();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* Hero: padrão de caju com a marca */}
      <section aria-label="Casa Kaju" className="relative isolate overflow-hidden bg-kaju-pink bg-[url(/img/padrao-caju.webp)] bg-cover bg-center">
        <div className="mx-auto flex min-h-[72svh] max-w-6xl flex-col items-center justify-center px-4 py-20 text-center">
          <div className="rounded-4xl bg-kaju-blush/55 px-8 py-10 shadow-2xl ring-1 ring-white/40 backdrop-blur-md sm:px-14">
            <h1>
              <span className="sr-only">Casa Kaju</span>
              <img src="/img/kaju-logo.webp" alt="" width={1200} height={393} fetchPriority="high" className="mx-auto h-auto w-56 sm:w-80" />
            </h1>
            <p className="mt-5 text-sm font-bold uppercase tracking-[0.18em] text-kaju-green sm:text-base">{SITE.tagline}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/orcamento" className="btn btn-green">
                Solicite um orçamento
              </Link>
              <a href="#espacos" className="btn btn-outline text-kaju-green hover:bg-kaju-green hover:text-kaju-cream">
                Conheça os espaços
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Espaços e serviços */}
      <section id="espacos" aria-labelledby="espacos-titulo" className="scroll-mt-16 bg-kaju-green px-4 py-16 text-kaju-pink sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 id="espacos-titulo" className="section-title text-center">
            Serviços Casa Kaju
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-kaju-cream/85">
            Salas, ateliê e estúdio para alugar, café e coworking e cursos. Escolha um e peça o orçamento.
          </p>
          <ul className="mt-10 flex flex-wrap justify-center gap-5 sm:gap-8">
            {SPACES.map((s) => (
              <li key={s.slug} className="w-[42%] sm:w-[28%] lg:w-[21%]">
                <Link href={quoteHref(s.service, s.interest)} className="group block rounded-full" aria-label={`${s.alt}: solicitar orçamento`}>
                  <img
                    src={s.image}
                    alt={s.alt}
                    width={720}
                    height={720}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full rounded-full shadow-lg ring-4 ring-kaju-pink/0 transition group-hover:-translate-y-1 group-hover:ring-kaju-pink/60"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {rooms.length ? (
        <>
          <div className="dots bg-kaju-green" aria-hidden />
          {/* Salas cadastradas na Coxia (com "Mostrar no site"): cada uma tem página com fotos e orçamento. */}
          <section id="nossos-espacos" aria-labelledby="nossos-espacos-titulo" className="scroll-mt-16 bg-kaju-green px-4 py-16 sm:px-6">
            <div className="mx-auto max-w-6xl">
              <h2 id="nossos-espacos-titulo" className="section-title text-center text-kaju-pink">
                Nossos espaços
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-center text-kaju-cream/85">Conheça cada espaço da casa e peça um orçamento direto na página dele.</p>
              <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <Link href={`/espacos/${r.slug}`} className="group flex h-full flex-col overflow-hidden rounded-3xl bg-kaju-cream text-kaju-green-deep shadow-lg transition hover:-translate-y-1">
                      <div className="relative aspect-[4/3] bg-kaju-pink bg-[url(/img/padrao-caju.webp)] bg-cover">
                        {r.photos[0] ? (
                          <Image src={photoUrl(r.slug, r.photos[0].id)} alt="" fill sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                        ) : null}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-6">
                        <h3 className="font-display text-xl font-extrabold">{r.name}</h3>
                        {r.capacity ? <p className="text-sm font-semibold text-kaju-rose-deep">Até {r.capacity} pessoas</p> : null}
                        {r.description ? <p className="text-sm leading-relaxed text-kaju-green-deep/85">{summary(r.description, 140)}</p> : null}
                        <span className="mt-auto pt-3 text-sm font-bold text-kaju-green underline-offset-4 group-hover:underline">Ver fotos e pedir orçamento →</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      ) : null}

      <div className="dots bg-kaju-green" aria-hidden />

      {/* Sobre as sócias */}
      <section id="sobre" aria-labelledby="sobre-titulo" className="scroll-mt-16 bg-kaju-green px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col items-center gap-5">
            <img src="/img/socias.webp" alt="Ju Herculano e Kao Maria, sócias da Kaju" width={1400} height={1440} loading="lazy" decoding="async" className="w-full max-w-md rounded-2xl object-cover shadow-xl" />
            <a href={SITE.instagram} target="_blank" rel="noopener" className="btn bg-kaju-pink text-kaju-green hover:bg-kaju-blush">
              <InstagramIcon /> Portfólio
            </a>
          </div>
          <div className="rounded-2xl bg-kaju-pink p-7 text-kaju-green-deep shadow-xl sm:p-10">
            <h2 id="sobre-titulo" className="font-display text-2xl font-extrabold sm:text-3xl">
              Sobre as sócias
            </h2>
            <div className="mt-5 space-y-4 text-[15px] leading-relaxed sm:text-base">
              <p>
                Sócia-fundadora, atriz, improvisadora e produtora cultural, <strong>Ju Herculano</strong> é graduada em Artes Cênicas pela UNESPAR (FAP) e atua há seis
                anos entre a improvisação teatral, a cenografia e a produção, somando ainda seu trabalho à Companhia Dupla Face e à co-criação da MoiM - Mostra de
                Improvisação Teatral.
              </p>
              <p>
                Ao seu lado, <strong>Kao Maria</strong>, artista e pesquisadora com quase uma década de experiência, também formada em Artes Cênicas pela Faculdade de
                Artes do Paraná. Sua trajetória abraça a hibridização das linguagens, principalmente entre figurino, direção e atuação (no teatro e no audiovisual). Em
                2023, ingressou no mestrado da Université Bordeaux Montaigne, na França, onde concebeu e estreou seu primeiro solo, “Exílio no Silêncio”. No ano
                seguinte, estagiou no Festival MIMOS (França), um dos maiores festivais de teatro gestual do mundo.
              </p>
              <p>Juntas, formam a essência da Kaju: uma empresa que entende o design cênico como encontro, investigação e poesia visual.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="dots bg-kaju-green" aria-hidden />

      {/* Cursos */}
      <section id="cursos" aria-labelledby="cursos-titulo" className="scroll-mt-16 bg-kaju-green px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 id="cursos-titulo" className="section-title text-center text-kaju-pink">
            Nossos cursos
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {COURSES.map((c) => (
              <li key={c.title} className="flex flex-col rounded-2xl bg-kaju-rose p-6 text-white shadow-lg">
                <h3 className="font-display text-xl font-extrabold leading-snug">{c.title}</h3>
                <p className="mt-2 text-sm text-white/90">
                  {c.when} · Casa Kaju
                </p>
                <Link href={quoteHref('course', c.title)} className="btn mt-6 self-start bg-kaju-cream text-kaju-rose-deep hover:bg-white">
                  Quero participar
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Design cênico */}
      <section id="design-cenico" aria-labelledby="design-titulo" className="relative scroll-mt-16 overflow-hidden bg-kaju-pink px-4 py-20 sm:px-6">
        <img src="/img/ilustracoes/maquina-de-costura.webp" alt="" aria-hidden width={480} height={411} loading="lazy" className="pointer-events-none absolute -left-6 top-40 hidden w-40 -rotate-6 opacity-90 lg:block xl:left-10" />
        <img src="/img/ilustracoes/martelo.webp" alt="" aria-hidden width={480} height={1002} loading="lazy" className="pointer-events-none absolute right-10 top-10 hidden w-16 rotate-12 opacity-90 lg:block xl:right-24" />
        <img src="/img/ilustracoes/serra.webp" alt="" aria-hidden width={480} height={139} loading="lazy" className="pointer-events-none absolute bottom-16 right-6 hidden w-56 -rotate-12 opacity-90 lg:block xl:right-20" />
        <img src="/img/ilustracoes/spray.webp" alt="" aria-hidden width={480} height={1194} loading="lazy" className="pointer-events-none absolute left-16 top-8 hidden w-12 -rotate-12 opacity-90 lg:block xl:left-40" />
        <img src="/img/ilustracoes/cola-quente.webp" alt="" aria-hidden width={480} height={274} loading="lazy" className="pointer-events-none absolute right-8 top-1/2 hidden w-28 rotate-6 opacity-90 lg:block xl:right-32" />
        <div className="relative mx-auto max-w-3xl text-kaju-green-deep">
          <h2 id="design-titulo" className="section-title text-center text-kaju-green">
            Especialistas em design cênico
          </h2>
          <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Serviços de design cênico">
            {DESIGN_SERVICES.map((s) => (
              <li key={s} className="rounded-full bg-kaju-green px-4 py-1.5 text-sm font-semibold text-kaju-cream">
                {s}
              </li>
            ))}
          </ul>
          <div className="mt-8 space-y-4 text-[15px] leading-relaxed sm:text-base">
            <p>
              Kao Maria e Ju Herculano são artistas da cena, <strong>especializadas em design cênico</strong>. Depois de quase uma década trabalhando nos mais diversos
              projetos, decidiram unir suas potências para dar vida à Kaju, um lugar onde a imaginação, técnica e sensibilidade se encontram.
            </p>
            <p>
              Elas se conheceram na faculdade de artes cênicas e, desde então, nunca deixaram de trabalhar juntas. Cada uma conta com seu próprio repertório, formando
              juntas a <strong>equipe perfeita para conceber o design completo</strong> de um espetáculo. Chega de conflitos entre áreas ou ideias desconectadas:{' '}
              <strong>na Kaju, tudo é pensado, criado e desenvolvido de maneira integrada, desde o primeiro rabisco no papel, até o último refletor ajustado.</strong>
            </p>
            <p>
              A dupla trabalha em seu <strong>próprio espaço, a Casa Kaju</strong>, um lugar concebido para que trocas artísticas possam florescer com aconchego, contando
              com um <strong>amplo ateliê</strong> equipado para criar, experimentar e materializar mundos inteiros. Um lugar onde as ideias se expandem e a cena ganha
              corpo, cor e textura.
            </p>
            <p className="text-center font-bold">Kaju: onde a cena encontra sua melhor forma.</p>
          </div>
          <div className="mt-8 flex justify-center">
            <Link href="/orcamento" className="btn btn-green">
              Solicite um orçamento
            </Link>
          </div>
        </div>
      </section>

      {/* Chamada final sobre o padrão de azulejos */}
      <section aria-labelledby="cta-titulo" className="bg-kaju-pink bg-[url(/img/padrao-azulejo.webp)] bg-size-[680px] bg-repeat px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-xl rounded-4xl bg-kaju-green p-8 text-center text-kaju-cream shadow-2xl sm:p-12">
          <h2 id="cta-titulo" className="font-display text-2xl font-extrabold sm:text-3xl">
            Tem um projeto em mente?
          </h2>
          <p className="mt-3 text-kaju-cream/85">Conte para a gente o que você imagina: respondemos pelo WhatsApp.</p>
          <Link href="/orcamento" className="btn btn-rose mt-7">
            Solicite um orçamento
          </Link>
        </div>
      </section>
    </>
  );
}
