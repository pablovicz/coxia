import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, DoorOpen, Images, KeyRound, Pencil, Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/input';
import { api, canManage, type Space } from '@/lib/api';
import { formatBRL } from '@/lib/format';
import { ROOM_STATUS, RoomIcon, roomStyle } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { describeHours } from './hours';
import { RoomForm } from './room-form';
import { RoomPhoto } from './room-photo';

/** Salas da casa: a administração cadastra; a equipe consulta e reserva pela agenda. */
export function RoomsPage() {
  const { session } = useAuth();
  const admin = canManage(session?.user.role);
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') });
  // null = fechado; 'new' = cadastro; Space = edição.
  const [editing, setEditing] = useState<Space | 'new' | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Espaços da casa"
        title="Salas."
        description={admin ? 'Cadastre as salas, a situação de cada uma e como aparecem na agenda.' : 'As salas da casa e quais estão abertas para reserva.'}
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/agenda">
                <CalendarDays aria-hidden /> Agenda
              </Link>
            </Button>
            {admin ? (
              <Button onClick={() => setEditing('new')}>
                <Plus aria-hidden /> Nova sala
              </Button>
            ) : null}
          </div>
        }
      />

      {spaces.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Carregando salas">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : spaces.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as salas.
        </p>
      ) : spaces.data.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="Nenhuma sala cadastrada"
          action={admin ? <Button onClick={() => setEditing('new')}>Cadastrar a primeira sala</Button> : undefined}
        >
          {admin ? 'Cadastre as salas para a equipe poder reservar pela agenda e pelo WhatsApp.' : 'A administração ainda não cadastrou as salas.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {spaces.data.map((s) => (
            <li key={s.id}>
              <RoomCard room={s} onEdit={admin ? () => setEditing(s) : undefined} />
            </li>
          ))}
        </ul>
      )}

      {/* Montagem condicional: o formulário abre sempre com os dados atuais. */}
      {editing ? <RoomForm room={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RoomCard({ room, onEdit }: { room: Space; onEdit?: () => void }) {
  const status = ROOM_STATUS[room.status];
  const cover = room.photos[0];
  return (
    <Card style={roomStyle(room.color)} className="flex h-full flex-col overflow-hidden">
      {cover ? (
        <div className="relative">
          <RoomPhoto spaceId={room.id} photoId={cover.id} alt={`Foto de ${room.name}`} className="aspect-[16/9] w-full" />
          {room.photos.length > 1 ? (
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
              <Images size={12} aria-hidden /> {room.photos.length} fotos
            </span>
          ) : null}
        </div>
      ) : (
        <div className="room-soft grid aspect-[16/9] place-items-center">
          <RoomIcon icon={room.icon} size={40} strokeWidth={1.5} className="room-text" />
        </div>
      )}
      <div className="room-fill h-1" aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
            <RoomIcon icon={room.icon} size={20} strokeWidth={1.75} className="room-text shrink-0" />
            <span className="truncate">{room.name}</span>
          </h2>
          <Badge variant={status.badge} className="shrink-0">
            {status.label}
          </Badge>
        </div>
        {room.description ? <p className="line-clamp-3 text-sm text-muted-foreground">{room.description}</p> : null}
        {room.hourlyRateCents ? (
          <p className="flex items-center gap-2 text-sm font-medium">
            <Tag size={16} aria-hidden className="shrink-0 text-muted-foreground" />
            {formatBRL(room.hourlyRateCents)}/hora
          </p>
        ) : null}
        {room.status === 'monthly_rental' && room.rentAmountCents ? (
          <p className="mt-auto flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound size={16} aria-hidden className="shrink-0" />
            {formatBRL(room.rentAmountCents)}/mês{room.rentDueDay ? ` · dia ${room.rentDueDay}` : ''}
            {room.tenantName ? ` · ${room.tenantName}` : ''}
          </p>
        ) : null}
        <p className={cn('flex items-center gap-2 text-sm text-muted-foreground', !(room.status === 'monthly_rental' && room.rentAmountCents) && 'mt-auto')}>
          <Clock size={16} aria-hidden className="shrink-0" />
          {describeHours(room.availabilityRules)}
        </p>
        {onEdit ? (
          <Button variant="outline" size="sm" className="self-start" onClick={onEdit} aria-label={`Editar ${room.name}`}>
            <Pencil aria-hidden /> Editar
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
