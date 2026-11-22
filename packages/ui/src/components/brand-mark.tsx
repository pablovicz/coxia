import mark from '../assets/kaju-mark.webp';
import { cn } from '../lib/utils';

/** Marca da Casa Kaju (os cajus). Decorativa: o nome vem ao lado, em texto. */
export function BrandMark({ className }: { className?: string }) {
  return <img src={mark} alt="" aria-hidden width={40} height={40} className={cn('size-10 shrink-0 object-contain', className)} />;
}
