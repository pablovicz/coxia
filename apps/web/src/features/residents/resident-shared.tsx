import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { initialsOf } from '@/components/user-avatar';
import { fetchResidentFile, type Resident, type ResidentSituation } from '@/lib/api';
import { cn } from '@/lib/utils';

export const SITUATION: Record<ResidentSituation, { label: string; variant: 'active' | 'pending' | 'late' | 'neutral' | 'info'; hint: string }> = {
  regular: { label: 'Regular', variant: 'active', hint: 'Pagamentos em dia' },
  attention: { label: 'Atenção', variant: 'pending', hint: 'Pagamento vencendo nos próximos dias' },
  overdue: { label: 'Pagamento atrasado', variant: 'late', hint: 'Tem pagamento vencido' },
  pending: { label: 'Pendente', variant: 'neutral', hint: 'Nenhum pagamento registrado ainda' },
};

export const WEEKDAY_SHORT: Record<string, string> = { MO: 'seg', TU: 'ter', WE: 'qua', TH: 'qui', FR: 'sex', SA: 'sáb', SU: 'dom' };

export const instagramUrl = (handle: string) => `https://instagram.com/${handle}`;

/** Foto enviada pela equipe; senão, a do WhatsApp; senão, as iniciais. */
export function ResidentPhoto({ resident, className }: { resident: Pick<Resident, 'id' | 'name' | 'photoUpdatedAt' | 'contact'>; className?: string }) {
  const uploaded = useQuery({
    queryKey: ['resident-photo', resident.id, resident.photoUpdatedAt],
    queryFn: () => fetchResidentFile(resident.id, 'photo', resident.photoUpdatedAt!),
    enabled: !!resident.photoUpdatedAt,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const url = useMemo(() => (uploaded.data ? URL.createObjectURL(uploaded.data) : null), [uploaded.data]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  const src = url ?? resident.contact.photoUrl;
  return (
    <span className={cn('grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-semibold text-secondary-foreground', className)}>
      {src ? <img src={src} alt="" className="size-full object-cover" /> : <span aria-hidden>{initialsOf(resident.name)}</span>}
    </span>
  );
}
