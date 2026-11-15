import type { NextConfig } from 'next';

/**
 * Site público da Casa Kaju (casakaju.com). Exportação estática: HTML pronto para cada página,
 * servido pelo nginx — carregamento rápido e bom para SEO, sem servidor Node em produção.
 */
const config: NextConfig = {
  output: 'export',
  // As imagens já são WebP no tamanho certo (public/img); sem otimizador em runtime.
  images: { unoptimized: true },
  // /orcamento/ vira orcamento/index.html: o nginx serve sem regra extra.
  trailingSlash: true,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
