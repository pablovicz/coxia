import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/input';
import { fetchSpacePhoto } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Foto de sala. O bucket é privado e o <img> não envia o token:
 * a foto vem da api como blob e vira uma URL local, liberada ao desmontar.
 */
export function RoomPhoto({ spaceId, photoId, alt, className }: { spaceId: string; photoId: string; alt: string; className?: string }) {
  const blob = useQuery({
    queryKey: ['space-photo', photoId],
    queryFn: () => fetchSpacePhoto(spaceId, photoId),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob.data) return;
    const u = URL.createObjectURL(blob.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob.data]);

  if (blob.isError) {
    return (
      <div className={cn('grid place-items-center bg-muted text-muted-foreground', className)} role="img" aria-label={`${alt} (não carregou)`}>
        <ImageOff size={20} aria-hidden />
      </div>
    );
  }
  if (!url) return <Skeleton className={cn('rounded-none', className)} />;
  return <img src={url} alt={alt} className={cn('object-cover', className)} />;
}
