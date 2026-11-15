import type { Metadata } from 'next';
import { QuoteForm } from '@/components/quote-form';

export const metadata: Metadata = {
  title: 'Solicite um orçamento',
  description:
    'Peça um orçamento à Casa Kaju: figurino, cenografia, iluminação, adereços, bonecos, aluguel de sala de ensaio, sala de reunião, ateliê e estúdio fotográfico, e cursos.',
  alternates: { canonical: '/orcamento' },
  openGraph: { url: '/orcamento', title: 'Solicite um orçamento · Casa Kaju' },
};

export default function QuotePage() {
  return (
    <section className="bg-kaju-pink bg-[url(/img/padrao-azulejo.webp)] bg-size-[680px] bg-repeat px-4 py-10 sm:px-6 sm:py-16">
      <QuoteForm />
    </section>
  );
}
