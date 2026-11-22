/** Imagens importadas como URL (o Vite de cada app resolve o arquivo). */
declare module '*.webp' {
  const src: string;
  export default src;
}
