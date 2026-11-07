import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiBodyError, apiSend, type Conflict, type Space } from '@/lib/api';
import { formatRange, local, toZonedIso } from '@/lib/format';

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const REASON: Record<Conflict['reason'], string> = {
  overlap: 'já reservado',
  blocked: 'sala bloqueada',
  outside_hours: 'fora do funcionamento',
};

export function conflictText(c: Conflict, tz: string): string {
  const day = local(c.startAt, tz).toFormat('ccc dd/LL');
  const who = c.with ? ` — ${c.with.title ?? 'reserva'}${c.with.responsibleName ? ` (${c.with.responsibleName})` : ''}` : '';
  return `${day}, ${formatRange(c.startAt, c.endAt, tz)}: ${REASON[c.reason]}${who}`;
}

export function BookingForm({
  open,
  onOpenChange,
  spaces,
  timezone,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaces: Space[];
  timezone: string;
  defaultDate: string;
}) {
  const qc = useQueryClient();
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState('14:00');
  const [end, setEnd] = useState('17:00');
  const [title, setTitle] = useState('');
  const [responsible, setResponsible] = useState('');
  const [phone, setPhone] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState('');
  const [notifyHour, setNotifyHour] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (onConflict: 'fail' | 'skip') =>
      apiSend<{ occurrences: unknown[]; skipped: Conflict[] }>('/bookings', 'POST', {
        spaceId,
        startAt: toZonedIso(date, start, timezone),
        endAt: toZonedIso(date, end, timezone),
        title: title || null,
        responsibleName: responsible || null,
        responsiblePhone: phone || null,
        notifyOneHourBefore: notifyHour,
        recurrence: repeat
          ? { rule: `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[DateTime.fromISO(date).weekday - 1]}`, until: until || null }
          : null,
        onConflict,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success(
        repeat
          ? `Série criada com ${res.occurrences.length} datas${res.skipped.length ? `; ${res.skipped.length} pulada(s) por conflito` : ''}.`
          : 'Reserva criada.',
      );
      onOpenChange(false);
      setConflicts(null);
    },
    onError: (err) => {
      if (err instanceof ApiBodyError && err.body.details?.conflicts?.length) {
        setConflicts(err.body.details.conflicts);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível reservar.');
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setConflicts(null);
    if (start >= end) return setError('O horário de início deve ser antes do fim.');
    mutation.mutate('fail');
  }

  const formId = 'booking-form';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nova reserva"
      description="O banco impede reservas sobrepostas na mesma sala."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {repeat && conflicts?.length ? (
            <Button variant="secondary" loading={mutation.isPending} onClick={() => mutation.mutate('skip')}>
              Criar pulando conflitos
            </Button>
          ) : null}
          <Button type="submit" form={formId} loading={mutation.isPending}>
            Reservar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Sala" className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={spaceId} onChange={(e) => setSpaceId(e.target.value)} required>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Data" className="sm:col-span-2">
          {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}
        </Field>
        <Field label="Início">{(id) => <Input id={id} type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required />}</Field>
        <Field label="Fim">{(id) => <Input id={id} type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} required />}</Field>
        <Field label="Atividade" className="sm:col-span-2">
          {(id) => <Input id={id} value={title} placeholder="Ex.: Ensaio" onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Responsável">{(id) => <Input id={id} value={responsible} onChange={(e) => setResponsible(e.target.value)} />}</Field>
        <Field label="WhatsApp do responsável" hint="Recebe o aviso da véspera">
          {(id, describedBy) => (
            <Input id={id} inputMode="tel" value={phone} placeholder="55 11 9…" aria-describedby={describedBy} onChange={(e) => setPhone(e.target.value)} />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label="Repetir toda semana neste dia" checked={repeat} onChange={setRepeat} />
          {repeat ? (
            <Field label="Até (opcional)" hint="Sem data final, a série segue renovando">
              {(id, describedBy) => <Input id={id} type="date" value={until} min={date} aria-describedby={describedBy} onChange={(e) => setUntil(e.target.value)} />}
            </Field>
          ) : null}
          <Checkbox label="Avisar o responsável 1h antes" checked={notifyHour} onChange={setNotifyHour} />
        </div>
      </form>

      {conflicts?.length ? (
        <div role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/8 p-3 text-sm">
          <p className="font-semibold text-destructive">
            {conflicts.length === 1 ? 'Esse horário não está disponível:' : `${conflicts.length} datas não estão disponíveis:`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.slice(0, 6).map((c) => (
              <li key={c.startAt}>{conflictText(c, timezone)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
