import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatRange, local } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { RoomTitle } from '@/components/balance';
import { ApiBodyError, api, apiSend, hours, type Occurrence } from '@/lib/api';
import { useTimezone } from '@/providers/auth';

export function CheckInResult({ tone, title, children, action }: { tone: 'ok' | 'wait' | 'error'; title: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'wait' ? Clock : XCircle;
  return (
    <div className="flex flex-col items-center py-4 text-center" role="status">
      <Icon size={48} strokeWidth={1.5} className={tone === 'ok' ? 'text-success' : tone === 'wait' ? 'text-muted-foreground' : 'text-destructive'} aria-hidden />
      <h1 className="mt-3 font-display text-2xl font-semibold">{title}</h1>
      {children ? <div className="mt-2 max-w-sm text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Link do convite: ao abrir, faz o check-in (se estiver na janela). */
export function CheckInPage() {
  const { id } = useParams();
  const tz = useTimezone();
  const qc = useQueryClient();
  const occ = useQuery({ queryKey: ['occurrence', id], queryFn: () => api<Occurrence>(`/me/bookings/occurrences/${id}`), refetchInterval: 30_000 });
  const checkIn = useMutation({
    mutationFn: () => apiSend<Occurrence>(`/me/bookings/occurrences/${id}/check-in`, 'POST'),
    onSuccess: (o) => {
      qc.setQueryData(['occurrence', id], o);
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const tried = useRef(false);
  useEffect(() => {
    if (occ.data?.canCheckIn && !tried.current) {
      tried.current = true;
      checkIn.mutate();
    }
  }, [occ.data?.canCheckIn, checkIn]);

  if (occ.isPending) return <Skeleton className="h-64 w-full" />;
  if (occ.isError || !occ.data) {
    return (
      <Card className="p-6">
        <CheckInResult tone="error" title="Reserva não encontrada" action={<Button asChild variant="outline"><Link to="/reservas">Minhas reservas</Link></Button>}>
          Confira se você entrou com a conta que recebeu o convite.
        </CheckInResult>
      </Card>
    );
  }
  const o = occ.data;
  const when = `${local(o.startAt, tz).toFormat("cccc, dd/MM")} · ${formatRange(o.startAt, o.endAt, tz)}`;
  const opensAt = local(new Date(new Date(o.startAt).getTime() - 15 * 60_000), tz).toFormat('HH:mm');
  let body: ReactNode;
  if (o.checkedInAt) {
    body = (
      <CheckInResult tone="ok" title="Check-in feito" action={<Button asChild variant="outline"><Link to="/">Início</Link></Button>}>
        Às {local(o.checkedInAt, tz).toFormat('HH:mm')}. Bom trabalho! A reserva usa {hours(o.minutes)} do seu saldo.
      </CheckInResult>
    );
  } else if (o.status === 'cancelled') {
    body = <CheckInResult tone="error" title="Reserva cancelada" />;
  } else if (checkIn.isPending || o.canCheckIn) {
    body = <CheckInResult tone="wait" title="Fazendo check-in…" />;
  } else if (checkIn.isError) {
    body = (
      <CheckInResult tone="error" title="Não deu para fazer o check-in" action={<Button onClick={() => checkIn.mutate()}>Tentar de novo</Button>}>
        {checkIn.error instanceof ApiBodyError ? checkIn.error.message : 'Tente de novo em instantes.'}
      </CheckInResult>
    );
  } else if (new Date(o.endAt) <= new Date()) {
    body = (
      <CheckInResult tone="error" title="O horário já terminou">
        As horas desta reserva foram consumidas mesmo sem check-in.
      </CheckInResult>
    );
  } else {
    body = (
      <CheckInResult tone="wait" title={`O check-in abre às ${opensAt}`}>
        Volte por este link (ou escaneie o QR code da sala) a partir de 15 minutos antes do início.
      </CheckInResult>
    );
  }
  return (
    <Card className="p-6" style={roomStyle(o.space.color)}>
      <RoomTitle space={o.space} subtitle={when} />
      <div className="mt-4 border-t pt-4">{body}</div>
    </Card>
  );
}
