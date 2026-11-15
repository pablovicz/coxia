import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000');

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/**
 * Site público da Casa Kaju (casakaju.com). Servidor do Next com páginas pré-geradas e
 * regeradas de tempos em tempos (ISR): as salas cadastradas na Coxia aparecem sozinhas,
 * cada uma com página própria, sem perder a velocidade de página estática.
 */
const config: NextConfig = {
  output: 'standalone',
  // Monorepo: o rastreamento de dependências parte da raiz (pnpm).
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    // Fotos das salas vêm da api (bucket privado); o Next redimensiona e converte para WebP/AVIF.
    remotePatterns: [{ protocol: apiUrl.protocol.replace(':', '') as 'http' | 'https', hostname: apiUrl.hostname, port: apiUrl.port, pathname: '/public/spaces/**' }],
    formats: ['image/avif', 'image/webp'],
    // Next 16 recusa otimizar imagem de IP local; só liberado quando a api é localhost (dev e testes).
    dangerouslyAllowLocalIP: apiUrl.hostname === 'localhost',
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async redirects() {
    // Um endereço só para o Google: www vai para o domínio principal.
    return [{ source: '/:path*', has: [{ type: 'host', value: 'www.casakaju.com' }], destination: 'https://casakaju.com/:path*', permanent: true }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      { source: '/img/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }] },
    ];
  },
};

export default config;
