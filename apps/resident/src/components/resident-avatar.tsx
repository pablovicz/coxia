import { cn } from '@coxia/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { apiBlob } from '@/lib/api';

export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** Foto do residente (bucket privado: passa pela api com o token). Sem foto, as iniciais. */
export function ResidentAvatar({ name, version, className }: { name: string | null | undefined; version: string | null | undefined; className?: string }) {
  const photo = useQuery({
    queryKey: ['me', 'photo', version],
    queryFn: () => apiBlob(`/me/photo?v=${encodeURIComponent(version ?? '')}`),
    enabled: !!version,
    staleTime: Infinity,
  });
  const url = useMemo(() => (photo.data ? URL.createObjectURL(photo.data) : null), [photo.data]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return (
    <span className={cn('grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-sm font-semibold text-secondary-foreground', className)} aria-hidden>
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initialsOf(name)}
    </span>
  );
}
