import Link from 'next/link';
import { SITE } from '@/lib/content';

const NAV = [
  { href: '/#espacos', label: 'Espaços' },
  { href: '/#sobre', label: 'Sobre' },
  { href: '/#design-cenico', label: 'Design cênico' },
];

export function InstagramIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/** Cabeçalho: no celular, o menu abre com <details> (funciona sem JavaScript). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-kaju-green/10 bg-kaju-cream/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Casa Kaju: página inicial" className="shrink-0">
          <img src="/img/kaju-logo.webp" alt="" width={1200} height={393} className="h-7 w-auto" />
        </Link>
        <nav aria-label="Principal" className="hidden items-center gap-6 text-sm font-semibold text-kaju-green md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-kaju-rose-deep">
              {n.label}
            </a>
          ))}
          <a href={SITE.instagram} target="_blank" rel="noopener" aria-label={`Instagram ${SITE.instagramHandle}`} className="hover:text-kaju-rose-deep">
            <InstagramIcon />
          </a>
          <Link href="/orcamento" className="btn btn-rose min-h-10 px-5 text-sm">
            Solicite um orçamento
          </Link>
        </nav>
        <details className="group relative md:hidden">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full text-kaju-green [&::-webkit-details-marker]:hidden" aria-label="Abrir menu">
            <svg viewBox="0 0 24 24" aria-hidden className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" className="group-open:hidden" />
              <path d="M6 6l12 12M18 6L6 18" className="hidden group-open:block" />
            </svg>
          </summary>
          <nav aria-label="Principal" className="absolute right-0 top-12 flex w-64 flex-col gap-1 rounded-2xl bg-kaju-cream p-3 text-kaju-green shadow-xl ring-1 ring-kaju-green/10">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="flex min-h-11 items-center rounded-lg px-3 font-semibold hover:bg-kaju-blush">
                {n.label}
              </a>
            ))}
            <a href={SITE.instagram} target="_blank" rel="noopener" className="flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold hover:bg-kaju-blush">
              <InstagramIcon /> Instagram
            </a>
            <Link href="/orcamento" className="btn btn-rose mt-2">
              Solicite um orçamento
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-kaju-green-deep text-kaju-cream">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <p className="font-display text-3xl font-extrabold tracking-wide">CASA KAJU</p>
          <p className="mt-2 text-kaju-pink">{SITE.tagline}</p>
        </div>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-kaju-pink">Fale com a gente</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a className="hover:underline" href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener">
                WhatsApp {SITE.whatsappLabel}
              </a>
            </li>
            <li>
              <a className="hover:underline" href={`mailto:${SITE.email}`}>
                {SITE.email}
              </a>
            </li>
            <li>
              <a className="inline-flex items-center gap-2 hover:underline" href={SITE.instagram} target="_blank" rel="noopener">
                <InstagramIcon className="size-4" /> {SITE.instagramHandle}
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-kaju-pink">Casa Kaju</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link className="hover:underline" href="/orcamento">
                Solicite um orçamento
              </Link>
            </li>
            <li>
              <a className="hover:underline" href="/#espacos">
                Espaços para alugar
              </a>
            </li>
            <li>
              <a className="hover:underline" href={SITE.team} rel="nofollow">
                Área da equipe
              </a>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t border-kaju-cream/10 px-4 py-5 text-center text-xs text-kaju-cream/70">© {new Date().getFullYear()} Casa Kaju</p>
    </footer>
  );
}
