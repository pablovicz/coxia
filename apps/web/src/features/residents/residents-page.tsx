import { useQuery } from '@tanstack/react-query';
import { Plus, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { api, canManage, type ResidentListItem } from '@/lib/api';
import { formatPhone } from '@coxia/ui/lib/format';
import { RoomIcon, roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { ResidentForm } from './resident-form';
import { ResidentPhoto, SITUATION } from './resident-shared';

type StatusFilter = 'active' | 'disabled' | 'all';

/** Residentes da casa: quem ocupa as salas com frequência, situação dos pagamentos e salas. */
export function ResidentsPage() {
  const { session } = useAuth();
  const admin = canManage(session?.user.role);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [creating, setCreating] = useState(false);
  const residents = useQuery({ queryKey: ['residents'], queryFn: () => api<ResidentListItem[]>('/residents') });
  const items = (residents.data ?? []).filter((r) => status === 'all' || r.status === status);
  const count = (s: StatusFilter) => (residents.data ?? []).filter((r) => s === 'all' || r.status === s).length;

  return (
    <>
      <PageHeader
        eyebrow="Pessoas"
        title="Residentes."
        description="Quem ocupa as salas com frequência: contrato, salas, horários e pagamentos."
        action={
          admin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Novo residente
            </Button>
          ) : null
        }
      />

      <div role="radiogroup" aria-label="Status" className="mb-4 inline-grid grid-cols-3 gap-1 rounded-md border bg-card p-1">
        {(
          [
            ['active', 'Ativos'],
            ['disabled', 'Desabilitados'],
            ['all', 'Todos'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={status === v}
            onClick={() => setStatus(v)}
            className={cn('min-h-11 rounded-sm px-3 text-sm font-medium text-muted-foreground lg:min-h-9', status === v && 'bg-primary text-primary-foreground')}
          >
            {label}
            {residents.data ? <span className="ml-1 tabular opacity-80">({count(v)})</span> : null}
          </button>
        ))}
      </div>

      {residents.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : residents.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os residentes.
        </p>
      ) : items.length === 0 ? (
        <EmptyState icon={UserCheck} title={status === 'disabled' ? 'Nenhum residente desabilitado' : 'Nenhum residente ainda'}>
          Cadastre um residente ou faça uma reserva semanal para um contato: ele vira residente sozinho.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => {
            const sit = SITUATION[r.situation];
            return (
              <li key={r.id}>
                <Link to={`/residentes/${r.id}`} className={cn('flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50', r.status === 'disabled' && 'opacity-70')}>
                  <span className="flex items-center gap-3">
                    <ResidentPhoto resident={r} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.name}</span>
                      <span className="tabular block truncate text-sm text-muted-foreground">
                        {formatPhone(r.contact.phone)}
                        {r.instagram ? ` · @${r.instagram}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge variant={sit.variant} title={sit.hint}>
                      {sit.label}
                    </Badge>
                    {r.status === 'disabled' ? <Badge variant="archived">Desabilitado</Badge> : null}
                    {r.paymentDay ? <Badge variant="neutral">Paga dia {r.paymentDay}</Badge> : null}
                  </span>
                  {r.rooms.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {r.rooms.map((s) => (
                        <span key={s.id} style={roomStyle(s.color)} className="room-soft inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                          <RoomIcon icon={s.icon} size={12} className="room-text" />
                          {s.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Sem sala fixa</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {creating ? <ResidentForm resident={null} onClose={() => setCreating(false)} /> : null}
    </>
  );
}
