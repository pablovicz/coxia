import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { fetchAvatar } from '@/lib/api';
import { cn } from '@/lib/utils';

export const initialsOf = (name: string | null | undefined) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * Foto de quem é da equipe; sem foto (ou enquanto carrega), as iniciais.
 * `version` é a data da última troca: muda a chave do cache quando a foto muda.
 */
export function UserAvatar({
  userId,
  name,
  version,
  className,
}: {
  userId: string | undefined;
  name: string | null | undefined;
  version: string | null | undefined;
  className?: string;
}) {
  const photo = useQuery({
    queryKey: ['avatar', userId, version],
    queryFn: () => fetchAvatar(userId!, version!),
    enabled: !!userId && !!version,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const url = useMemo(() => (photo.data ? URL.createObjectURL(photo.data) : null), [photo.data]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-sm font-semibold text-secondary-foreground', className)}>
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <span aria-hidden>{initialsOf(name)}</span>}
    </span>
  );
}
