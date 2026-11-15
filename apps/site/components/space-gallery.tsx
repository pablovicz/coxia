'use client';

import Image from 'next/image';
import { useState } from 'react';

/** Galeria da sala: foto grande e miniaturas para trocar. Sem foto, um bloco com a marca. */
export function SpaceGallery({ name, photos }: { name: string; photos: Array<{ id: string; src: string }> }) {
  const [current, setCurrent] = useState(0);
  if (!photos.length) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-3xl bg-kaju-pink bg-[url(/img/padrao-caju.webp)] bg-cover">
        <span className="rounded-2xl bg-kaju-blush/80 px-5 py-3 font-display text-xl font-extrabold text-kaju-green">{name}</span>
      </div>
    );
  }
  const main = photos[current] ?? photos[0]!;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-kaju-green-deep shadow-xl">
        <Image
          key={main.id}
          src={main.src}
          alt={`${name}: foto ${current + 1} de ${photos.length}`}
          fill
          priority={current === 0}
          sizes="(min-width: 1024px) 640px, 100vw"
          className="object-cover"
        />
      </div>
      {photos.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="Fotos do espaço">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setCurrent(i)}
                aria-label={`Ver foto ${i + 1}`}
                aria-current={i === current}
                className={`relative block aspect-square w-full overflow-hidden rounded-xl ring-offset-2 ring-offset-kaju-green transition ${i === current ? 'ring-3 ring-kaju-pink' : 'opacity-80 hover:opacity-100'}`}
              >
                <Image src={p.src} alt="" fill sizes="120px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
