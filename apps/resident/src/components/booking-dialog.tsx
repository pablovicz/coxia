import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Checkbox, Field, Select } from '@coxia/ui/components/ui/field';
import { Input, Textarea } from '@coxia/ui/components/ui/input';
import { formatDayTitle, local } from '@coxia/ui/lib/format';
import { cn } from '@coxia/ui/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiBodyError, apiSend, brDayMonth, type Conflict, type Contract, type CycleBalance, hours, type Interval, type OpenCycle } from '@/lib/api';
import { MIN, slotsOf, STEP } from '@/lib/slots';
import { useTimezone } from '@/providers/auth';

/**
 * Reservar num dia da agenda: horário de início, duração, nome e descrição (só o residente vê)
 * e, se quiser, repetir toda semana até o fim do ciclo.
 */
export function BookingDialog({
  contract,
  date,
  free,
  cycle,
  balance,
  initialStart,
  onClose,
}: {
  contract: Contract;
  date: string;
  free: Interval[];
  cycle: OpenCycle;
  balance: CycleBalance | null;
  initialStart?: string | null;
  onClose: () => void;
}) {
  const tz = useTimezone();
  const qc = useQueryClient();
  const slots = useMemo(() => slotsOf(free, tz, DateTime.now().setZone(tz)), [free, tz]);
  const [start, setStart] = useState<string | null>(initialStart ?? null);
  const [duration, setDuration] = useState(MIN);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = slots.find((s) => s.start.toISO() === start) ?? null;
  const available = balance?.availableMinutes ?? 0;
  const maxDuration = chosen ? Math.min(Math.floor(chosen.freeUntil.diff(chosen.start, 'minutes').minutes / STEP) * STEP, Math.floor(available / STEP) * STEP, 12 * 60) : 0;
  const durations = Array.from({ length: Math.max(0, (maxDuration - MIN) / STEP + 1) }, (_, i) => MIN + i * STEP);
  useEffect(() => {
    if (duration > maxDuration && maxDuration >= MIN) setDuration(maxDuration);
  }, [duration, maxDuration]);
  const weeks = chosen && weekly ? Math.floor(DateTime.fromISO(cycle.bookableUntil).diff(chosen.start.startOf('day'), 'days').days / 7) + 1 : 1;

  const book = useMutation({
    mutationFn: (onConflict: 'fail' | 'skip') =>
      apiSend<{ occurrences: Array<{ id: string }>; skipped: Conflict[] }>('/me/bookings', 'POST', {
        contractId: contract.id,
        startAt: chosen!.start.toISO({ suppressMilliseconds: true }),
        endAt: chosen!.start.plus({ minutes: duration }).toISO({ suppressMilliseconds: true }),
        repeatWeekly: weekly,
        onConflict,
        label: label.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: (res) => {
      const n = res.occurrences.length;
      toast.success(n > 1 ? `${n} reservas feitas. O convite de cada uma vai para o seu e-mail.` : 'Reserva feita. O convite vai para o seu e-mail.');
      if (res.skipped.length) toast.message(`${res.skipped.length} data(s) puladas por conflito.`);
      void qc.invalidateQueries();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiBodyError && err.status === 409) {
        const list = (err.body.details as { conflicts?: Conflict[] } | null)?.conflicts ?? [];
        setConflicts(list);
        setError(weekly && list.length ? null : 'Esse horário acabou de ser ocupado. Escolha outro.');
        void qc.invalidateQueries({ queryKey: ['availability'] });
        return;
      }
      setError(err instanceof ApiBodyError ? err.message : 'Não foi possível reservar agora.');
    },
  });

  return (
    <Dialog
      open
      size="wide"
      onOpenChange={(v) => !v && onClose()}
      title={`Reservar · ${formatDayTitle(date)}`}
      description={`${contract.space.name} · ${balance ? `${hours(available)} disponíveis no ciclo (até ${brDayMonth(balance.endsOn)})` : ''}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!chosen || maxDuration < MIN} loading={book.isPending} onClick={() => (setError(null), book.mutate('fail'))}>
            Confirmar reserva
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="inicio">
          <h3 id="inicio" className="mb-2 text-sm font-medium">
            Início
          </h3>
          {slots.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Sem horários livres neste dia.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Horário de início">
              {slots.map((s) => {
                const iso = s.start.toISO()!;
                return (
                  <button
                    key={iso}
                    type="button"
                    role="radio"
                    aria-checked={start === iso}
                    onClick={() => (setStart(iso), setConflicts(null), setError(null))}
                    className={cn('tabular min-h-11 rounded-md border text-sm font-medium transition-colors', start === iso ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
                  >
                    {s.start.toFormat('HH:mm')}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          {!chosen ? (
            <p className="text-sm text-muted-foreground">Escolha o horário de início.</p>
          ) : maxDuration < MIN ? (
            <p role="alert" className="text-sm text-destructive">
              {available < MIN ? `Saldo insuficiente: o ciclo tem ${hours(Math.max(0, available))} disponíveis.` : 'Não há 1 hora livre a partir deste horário.'}
            </p>
          ) : (
            <>
              <Field label="Duração">
                {(id) => (
                  <Select id={id} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    {durations.map((m) => (
                      <option key={m} value={m}>
                        {hours(m)} · até {chosen.start.plus({ minutes: m }).toFormat('HH:mm')}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Nome (opcional)" hint="Só você vê.">
                {(id, d) => <Input id={id} value={label} maxLength={80} aria-describedby={d} placeholder="Ex.: Ensaio da peça" onChange={(e) => setLabel(e.target.value)} />}
              </Field>
              <Field label="Descrição (opcional)">{(id) => <Textarea id={id} rows={2} value={notes} maxLength={1000} placeholder="Anotações para você" onChange={(e) => setNotes(e.target.value)} />}</Field>
              <Checkbox label={`Repetir toda ${chosen.start.setLocale('pt-BR').toFormat('cccc')} até ${brDayMonth(cycle.bookableUntil)}`} checked={weekly} onChange={setWeekly} />
              <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                <strong className="text-foreground">
                  {chosen.start.toFormat('HH:mm')}–{chosen.start.plus({ minutes: duration }).toFormat('HH:mm')}
                  {weekly && weeks > 1 ? ` · ${weeks} semanas` : ''}
                </strong>{' '}
                · usa {hours(duration * weeks)} do saldo{weekly && duration * weeks > available ? ' (mais do que o disponível: algumas datas podem não caber)' : ''}. Cancelando antes do início, as horas voltam.
              </p>
            </>
          )}
          {conflicts?.length ? (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium text-destructive">Algumas datas não estão livres:</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {conflicts.slice(0, 6).map((c) => (
                  <li key={c.startAt}>
                    {local(c.startAt, tz).toFormat('dd/MM HH:mm')} — {c.reason === 'overlap' ? 'já reservado' : c.reason === 'blocked' ? 'sala bloqueada' : 'fora do horário da sala'}
                  </li>
                ))}
              </ul>
              {weekly ? (
                <Button className="mt-3" variant="outline" size="sm" loading={book.isPending} onClick={() => book.mutate('skip')}>
                  Reservar as outras datas
                </Button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
