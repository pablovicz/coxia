import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/chrome';
import { SITE } from '@/lib/content';
import './globals.css';

// Fontes servidas pelo próprio site (next/font baixa no build): sem requisição ao Google no acesso.
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat', display: 'swap' });
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap', weight: ['600', '800'] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} · ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: SITE.url,
    siteName: SITE.name,
    title: `${SITE.name} · ${SITE.tagline}`,
    description: SITE.description,
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Casa Kaju' }],
  },
  icons: { icon: '/favicon.png', apple: '/apple-touch-icon.png' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: '#1e4b36', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${montserrat.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-kaju-cream focus:px-4 focus:py-2">
          Pular para o conteúdo
        </a>
        <SiteHeader />
        <main id="conteudo">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
