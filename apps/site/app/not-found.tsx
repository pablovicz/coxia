import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="bg-kaju-pink px-4 py-24 text-center text-kaju-green-deep">
      <h1 className="font-display text-4xl font-extrabold">Página não encontrada</h1>
      <p className="mt-3">Essa cena não está no roteiro.</p>
      <Link href="/" className="btn btn-green mt-8">
        Voltar para o início
      </Link>
    </section>
  );
}
