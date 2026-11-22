import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field } from '@coxia/ui/components/ui/field';
import { Input, Skeleton, Textarea } from '@coxia/ui/components/ui/input';
import { formatRange, local } from '@coxia/ui/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiBodyError, api, apiSend, hours, type Occurrence } from '@/lib/api';
import { useTimezone } from '@/providers/auth';
import { AttendanceBadge } from './occurrence-card';

/** Uma reserva minha: nome e descrição (só eu vejo), e cancelar esta ou a série. */
export function OccurrenceDialog({ occurrenceId, onClose }: { occurrenceId: string; onClose: () => void }) {
  const tz = useTimezone();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['occurrence', occurrenceId], queryFn: () => api<Occurrence>(`/me/bookings/occurrences/${occurrenceId}`) });
  const o = q.data;
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (o) {
      setLabel(o.label ?? '');
      setNotes(o.notes ?? '');
    }
  }, [o]);

  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries();
    onClose();
  };
  const fail = (err: unknown) => toast.error(err instanceof ApiBodyError ? err.message : 'Não foi possível agora.');
  const save = useMutation({ mutationFn: () => apiSend(`/me/bookings/${o!.bookingId}`, 'PATCH', { label: label.trim() || null, notes: notes.trim() || null }), onSuccess: () => done('Reserva atualizada.'), onError: fail });
  const one = useMutation({ mutationFn: () => apiSend(`/me/bookings/occurrences/${occurrenceId}/cancel`, 'POST'), onSuccess: () => done(`Reserva cancelada. ${hours(o!.minutes)} voltaram para o saldo.`), onError: fail });
  const series = useMutation({
    mutationFn: () => apiSend<{ cancelled: number }>(`/me/bookings/${o!.bookingId}/cancel-series`, 'POST', { fromDate: local(o!.startAt, tz).toISODate() }),
    onSuccess: (r) => done(`${r.cancelled} reserva(s) cancelada(s). As horas voltaram para o saldo.`),
    onError: fail,
  });
  const dirty = !!o && (label.trim() !== (o.label ?? '') || notes.trim() !== (o.notes ?? ''));

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={o?.label || 'Reserva'}
      description={o ? `${local(o.startAt, tz).toFormat("cccc, dd/MM")} · ${formatRange(o.startAt, o.endAt, tz)} · ${o.space.name}` : undefined}
      footer={
        !o ? null : confirm ? (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Voltar
            </Button>
            {o.recurring ? (
              <Button variant="outline" loading={series.isPending} onClick={() => series.mutate()}>
                Esta e as próximas
              </Button>
            ) : null}
            <Button variant="destructive" loading={one.isPending} onClick={() => one.mutate()}>
              {o.recurring ? 'Só esta' : 'Cancelar reserva'}
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {o.canCancel ? (
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>
                Cancelar reserva
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                Salvar
              </Button>
            </div>
          </div>
        )
      }
    >
      {!o ? (
        <Skeleton className="h-32 w-full" />
      ) : confirm ? (
        <p className="text-sm">As {hours(o.minutes)} desta reserva voltam para o saldo do ciclo e o convite sai do seu calendário.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="tabular font-medium text-foreground">{hours(o.minutes)}</span>
            {o.recurring ? (
              <span className="inline-flex items-center gap-1">
                <Repeat size={14} aria-hidden /> semanal
              </span>
            ) : null}
            <AttendanceBadge o={o} />
          </p>
          <Field label="Nome (opcional)" hint={o.recurring ? 'Só você vê. Vale para todas as datas desta série.' : 'Só você vê.'}>
            {(id, d) => <Input id={id} value={label} maxLength={80} aria-describedby={d} placeholder="Ex.: Ensaio da peça" onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <Field label="Descrição (opcional)">{(id) => <Textarea id={id} rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
      )}
    </Dialog>
  );
}
