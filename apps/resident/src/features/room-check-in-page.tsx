import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatRange, local } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { RoomTitle } from '@/components/balance';
import { ApiBodyError, api, apiSend, hours, type Occurrence, type RoomStatus } from '@/lib/api';
import { useTimezone } from '@/providers/auth';
import { CheckInResult } from './check-in-page';

/**
 * QR code colado na sala. Com reserva agora: check-in direto. Sem reserva e sala livre:
 * escolhe por quanto tempo vai usar (cria a reserva e já faz o check-in).
 */
export function RoomCheckInPage() {
  const { spaceId } = useParams();
  const tz = useTimezone();
  const qc = useQueryClient();
  const [duration, setDuration] = useState<number | null>(null);
  const status = useQuery({ queryKey: ['room', spaceId], queryFn: () => api<RoomStatus>(`/me/rooms/${spaceId}/check-in`), refetchInterval: 30_000 });
  const checkIn = useMutation({
    mutationFn: (durationMinutes?: number) => apiSend<Occurrence>(`/me/rooms/${spaceId}/check-in`, 'POST', durationMinutes ? { durationMinutes } : {}),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
  const tried = useRef(false);
  useEffect(() => {
    if (status.data?.state === 'booking' && status.data.occurrence.canCheckIn && !tried.current) {
      tried.current = true;
      checkIn.mutate(undefined);
    }
  }, [status.data, checkIn]);

  if (status.isPending) return <Skeleton className="h-64 w-full" />;
  if (status.isError || !status.data) {
    return (
      <Card className="p-6">
        <CheckInResult tone="error" title="Sala não encontrada">
          O QR code pode estar desatualizado. Fale com a equipe da Casa Kaju.
        </CheckInResult>
      </Card>
    );
  }
  const s = status.data;
  const done = checkIn.data ?? (s.state === 'checked_in' ? s.occurrence : null);
  let body: React.ReactNode = null;
  if (done) {
    body = (
      <CheckInResult tone="ok" title="Check-in feito" action={<Button asChild variant="outline"><Link to="/">Início</Link></Button>}>
        {formatRange(done.startAt, done.endAt, tz)} · {hours(done.minutes)} do seu saldo.
      </CheckInResult>
    );
  } else if (checkIn.isPending) {
    body = <CheckInResult tone="wait" title="Fazendo check-in…" />;
  } else if (s.state === 'booking') {
    body = s.occurrence.canCheckIn ? (
      <CheckInResult tone="error" title="Não deu para fazer o check-in" action={<Button onClick={() => checkIn.mutate(undefined)}>Tentar de novo</Button>}>
        {checkIn.error instanceof ApiBodyError ? checkIn.error.message : null}
      </CheckInResult>
    ) : (
      <CheckInResult tone="wait" title={`Sua reserva começa às ${local(s.occurrence.startAt, tz).toFormat('HH:mm')}`}>
        O check-in abre 15 minutos antes.
      </CheckInResult>
    );
  } else if (s.state === 'no_contract') {
    body = (
      <CheckInResult tone="error" title="Esta sala não está no seu contrato">
        Para usar outra sala, fale com a equipe da Casa Kaju.
      </CheckInResult>
    );
  } else if (s.state === 'occupied') {
    body = (
      <CheckInResult tone="wait" title={`Sala ocupada até ${local(s.until, tz).toFormat('HH:mm')}`} action={<Button asChild variant="outline"><Link to="/agenda">Reservar outro horário</Link></Button>} />
    );
  } else if (s.state === 'unavailable') {
    const msg = {
      closed: 'A sala está fechada agora.',
      no_balance: `Seu saldo do ciclo não tem 1 hora livre (${hours(s.availableMinutes ?? 0)} disponíveis).`,
      too_short: 'Não há 1 hora livre a partir de agora antes da próxima reserva ou do fechamento.',
      contract_closed: 'O seu contrato desta sala não está vigente hoje.',
    }[s.reason];
    body = <CheckInResult tone="error" title="Não dá para usar a sala agora">{msg}</CheckInResult>;
  } else if (s.state === 'walk_in') {
    const options = Array.from({ length: Math.max(0, (s.maxMinutes - 60) / 30 + 1) }, (_, i) => 60 + i * 30);
    const start = local(s.startAt, tz);
    body = (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Sala livre agora</h1>
          <p className="mt-1 text-sm text-muted-foreground">Você não tem reserva neste horário. Por quanto tempo vai usar? Saldo do ciclo: {hours(s.availableMinutes)}.</p>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Duração">
          {options.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={duration === m}
              onClick={() => setDuration(m)}
              className={cn('flex min-h-14 flex-col items-center justify-center rounded-md border text-sm', duration === m ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
            >
              <span className="tabular font-semibold">{hours(m)}</span>
              <span className={cn('tabular text-xs', duration === m ? 'opacity-85' : 'text-muted-foreground')}>até {start.plus({ minutes: m }).toFormat('HH:mm')}</span>
            </button>
          ))}
        </div>
        {checkIn.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {checkIn.error instanceof ApiBodyError ? checkIn.error.message : 'Não foi possível agora.'}
          </p>
        ) : null}
        <Button disabled={!duration} loading={checkIn.isPending} onClick={() => duration && checkIn.mutate(duration)}>
          Usar a sala e fazer check-in
        </Button>
      </div>
    );
  }
  return (
    <Card className="p-6" style={roomStyle(s.space.color)}>
      <RoomTitle space={s.space} subtitle="Check-in pelo QR code" />
      <div className="mt-4 border-t pt-4">{body}</div>
    </Card>
  );
}
