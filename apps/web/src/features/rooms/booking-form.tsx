import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ContactPicker } from '@/features/contacts/contact-picker';
import { ContactAvatar } from '@/features/contacts/contact-avatar';
import { ApiBodyError, apiSend, type Conflict, type Contact, type Space } from '@/lib/api';
import { centsToInput, formatBRL, formatPhone, formatRange, local, parseBRL, todayIn, toZonedIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import { WEEKDAYS } from './hours';

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

/** Durações de 30 min a 12 h. */
const DURATIONS = Array.from({ length: 24 }, (_, i) => (i + 1) * 30);
export const durationLabel = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)}h${min % 60}` : `${min / 60}h`);

/** "16:00" → "16h"; "16:30" → "16h30". */
const endLabel = (hhmm: string) => hhmm.replace(':00', 'h').replace(':', 'h');

function addMinutes(hhmm: string, minutes: number): string | null {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  if (total > 24 * 60) return null;
  if (total === 24 * 60) return '23:59';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Nova reserva: sala, atividade, uma vez (data, horário, duração) ou recorrente (dias da semana,
 * horário, duração, até quando), quem vai usar a sala (contato ou cadastro na hora) e o valor da hora.
 */
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
  const today = todayIn(timezone);
  const firstDate = defaultDate < today ? today : defaultDate;
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [date, setDate] = useState(firstDate);
  const [days, setDays] = useState<number[]>([DateTime.fromISO(firstDate).weekday]);
  const [start, setStart] = useState('14:00');
  const [duration, setDuration] = useState(120);
  // Opcional: horário e duração próprios para cada dia marcado (senão, todos usam os de cima).
  const [perDay, setPerDay] = useState(false);
  const [dayTimes, setDayTimes] = useState<Record<number, { start: string; duration: number }>>({});
  const [until, setUntil] = useState('');
  const [contact, setContact] = useState<Contact | null>(null);
  const [newPerson, setNewPerson] = useState(false);
  const [personName, setPersonName] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const space = spaces.find((s) => s.id === spaceId);
  const [rate, setRate] = useState(space?.hourlyRateCents != null ? centsToInput(space.hourlyRateCents) : '');
  const [notifyHour, setNotifyHour] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trocar de sala traz o valor da hora dela.
  function pickSpace(id: string) {
    setSpaceId(id);
    const s = spaces.find((x) => x.id === id);
    setRate(s?.hourlyRateCents != null ? centsToInput(s.hourlyRateCents) : '');
  }

  const end = addMinutes(start, duration);
  const sortedDays = [...days].sort((a, b) => a - b);
  /** Horário e duração de cada dia marcado (os de cima, ou os próprios do dia). */
  const daySlots = sortedDays.map((weekday) => {
    const own = perDay ? dayTimes[weekday] : undefined;
    const st = own?.start ?? start;
    const dur = own?.duration ?? duration;
    return { weekday, start: st, duration: dur, end: addMinutes(st, dur) };
  });
  function setDayTime(weekday: number, patch: Partial<{ start: string; duration: number }>) {
    setDayTimes((t) => ({ ...t, [weekday]: { start: t[weekday]?.start ?? start, duration: t[weekday]?.duration ?? duration, ...patch } }));
  }
  const rateCents = rate.trim() ? parseBRL(rate) : null;

  const mutation = useMutation({
    mutationFn: (onConflict: 'fail' | 'skip') => {
      const person = contact
        ? { contactId: contact.id }
        : { responsibleName: personName.trim(), responsiblePhone: personPhone.trim() };
      const common = { spaceId, title: title.trim() || null, hourlyRateCents: rateCents, notifyOneHourBefore: notifyHour, onConflict, ...person };
      return apiSend<{ occurrences: unknown[]; skipped: Conflict[] }>(
        '/bookings',
        'POST',
        recurring
          ? { ...common, weekly: { startsOn: firstDate, until: until || null, slots: daySlots.map((d) => ({ weekday: d.weekday, start: d.start, end: d.end })) } }
          : { ...common, startAt: toZonedIso(date, start, timezone), endAt: toZonedIso(date, end!, timezone) },
      );
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(
        recurring
          ? `Reserva recorrente criada com ${res.occurrences.length} datas${res.skipped.length ? `; ${res.skipped.length} pulada(s) por conflito` : ''}.`
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
    if (!end || (recurring && daySlots.some((d) => !d.end))) {
      return setError('A reserva precisa terminar no mesmo dia: diminua a duração ou comece mais cedo.');
    }
    if (recurring && days.length === 0) return setError('Marque pelo menos um dia da semana.');
    if (recurring && until && until < firstDate) return setError('"Repetir até" precisa ser depois de hoje.');
    if (!contact && (!personName.trim() || personPhone.replace(/\D/g, '').length < 10)) {
      return setError('Informe o responsável: escolha um contato ou cadastre nome e telefone (com DDD).');
    }
    if (rate.trim() && !rateCents) return setError('Valor da hora inválido. Use, por exemplo, 80,00.');
    mutation.mutate('fail');
  }

  const hours = duration / 60;
  const total = rateCents ? Math.round(hours * rateCents) : null;
  const weekTotal = rateCents ? daySlots.reduce((sum, d) => sum + Math.round((d.duration / 60) * rateCents), 0) : null;
  const discount = space?.hourlyRateCents && rateCents && rateCents < space.hourlyRateCents ? Math.round((1 - rateCents / space.hourlyRateCents) * 100) : null;

  const formId = 'booking-form';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title="Nova reserva"
      description="O banco impede reservas sobrepostas na mesma sala."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {recurring && conflicts?.length ? (
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
      <form id={formId} onSubmit={submit} className="grid gap-x-8 gap-y-5 lg:grid-cols-2" noValidate>
        {/* Esquerda: o quê, onde, quem e quanto. */}
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Sala">
            {(id) => (
              <Select id={id} value={spaceId} onChange={(e) => pickSpace(e.target.value)} required>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Atividade">
            {(id) => <Input id={id} value={title} maxLength={120} placeholder="Ex.: Ensaio" onChange={(e) => setTitle(e.target.value)} />}
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Responsável</legend>
            {contact ? (
              <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
                <ContactAvatar contact={contact} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{contact.name ?? contact.whatsappName ?? formatPhone(contact.phone)}</p>
                  <p className="tabular text-sm text-muted-foreground">{formatPhone(contact.phone)}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setContact(null)}>
                  Trocar
                </Button>
              </div>
            ) : newPerson ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome do responsável">{(id) => <Input id={id} value={personName} maxLength={120} onChange={(e) => setPersonName(e.target.value)} />}</Field>
                <Field label="WhatsApp do responsável" hint="Vira contato; recebe o aviso da véspera">
                  {(id, describedBy) => (
                    <Input id={id} inputMode="tel" value={personPhone} placeholder="11 98765-4321" aria-describedby={describedBy} onChange={(e) => setPersonPhone(e.target.value)} />
                  )}
                </Field>
                <button type="button" className="min-h-11 text-left text-sm font-medium text-primary underline-offset-4 hover:underline sm:col-span-2" onClick={() => setNewPerson(false)}>
                  Buscar nos contatos
                </button>
              </div>
            ) : (
              <>
                <ContactPicker onPick={setContact} inputId="booking-contact" />
                <button type="button" className="min-h-11 self-start text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setNewPerson(true)}>
                  Não está nos contatos? Cadastrar
                </button>
              </>
            )}
          </fieldset>

          <Field
            label="Valor da hora (R$)"
            hint={space?.hourlyRateCents ? `Valor da sala: ${formatBRL(space.hourlyRateCents)}/h${discount ? ` · desconto de ${discount}%` : ''}` : 'Sala sem preço cadastrado'}
          >
            {(id, describedBy) => (
              <Input id={id} inputMode="decimal" className="tabular" value={rate} placeholder="0,00" aria-describedby={describedBy} onChange={(e) => setRate(e.target.value)} />
            )}
          </Field>
          {total ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm" aria-live="polite">
              {recurring && perDay ? (
                <>
                  Por semana: <strong className="tabular">{formatBRL(weekTotal ?? 0)}</strong> ({formatBRL(rateCents!)}/h)
                </>
              ) : (
                <>
                  {recurring ? 'Por dia: ' : 'Locação: '}
                  {durationLabel(duration)} × {formatBRL(rateCents!)} = <strong className="tabular">{formatBRL(total)}</strong>
                  {recurring && days.length > 1 ? (
                    <>
                      {' '}
                      · por semana: <strong className="tabular">{formatBRL(weekTotal ?? 0)}</strong>
                    </>
                  ) : null}
                </>
              )}
            </p>
          ) : null}
          {/* Desktop: lembrete na coluna da esquerda. No celular, vai para o fim do formulário. */}
          <ReminderOption className="hidden lg:block" checked={notifyHour} onChange={setNotifyHour} />
        </div>

        {/* Direita: quando (uma vez ou recorrente). */}
        <div className="grid min-w-0 content-start gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Recorrente?</legend>
            <div role="radiogroup" aria-label="Recorrente?" className="grid grid-cols-2 gap-1 rounded-md border bg-card p-1">
              {[
                [false, 'Não, uma vez'],
                [true, 'Sim, toda semana'],
              ].map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  role="radio"
                  aria-checked={recurring === value}
                  onClick={() => setRecurring(value as boolean)}
                  className={cn('min-h-11 rounded-sm text-sm font-medium text-muted-foreground', recurring === value && 'bg-primary text-primary-foreground')}
                >
                  {label as string}
                </button>
              ))}
            </div>
          </fieldset>

          {recurring ? (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Dias</legend>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
                {WEEKDAYS.map((d) => {
                  const on = days.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      aria-pressed={on}
                      aria-label={d.long}
                      onClick={() => setDays((list) => (on ? list.filter((x) => x !== d.n) : [...list, d.n]))}
                      className={cn(
                        'min-h-11 min-w-11 rounded-md border px-2 text-sm font-medium',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <Field label="Data" className="sm:col-span-2">
              {(id) => <Input id={id} type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />}
            </Field>
          )}

          {recurring && perDay ? null : (
            <>
              <Field label="Horário">{(id) => <Input id={id} type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required />}</Field>
              <Field label="Duração" hint={end ? `Termina às ${endLabel(end)}` : 'Passa da meia-noite'}>
                {(id, describedBy) => (
                  <Select id={id} value={String(duration)} aria-describedby={describedBy} onChange={(e) => setDuration(Number(e.target.value))}>
                    {DURATIONS.map((m) => (
                      <option key={m} value={m}>
                        {durationLabel(m)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          {recurring && days.length > 1 ? (
            <div className="sm:col-span-2">
              <Checkbox label="Horário diferente por dia (opcional)" checked={perDay} onChange={setPerDay} />
            </div>
          ) : null}
          {recurring && perDay && days.length > 1 ? (
            <fieldset className="flex flex-col gap-2 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">Horário de cada dia</legend>
              {daySlots.map((d) => {
                const label = WEEKDAYS[d.weekday - 1]!;
                return (
                  <div key={d.weekday} role="group" aria-label={label.long} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2">
                    <span className="text-sm font-semibold">{label.short}</span>
                    <label className="sr-only" htmlFor={`start-${d.weekday}`}>
                      Horário de {label.long}
                    </label>
                    <Input
                      id={`start-${d.weekday}`}
                      type="time"
                      step={900}
                      value={d.start}
                      onChange={(e) => setDayTime(d.weekday, { start: e.target.value })}
                    />
                    <label className="sr-only" htmlFor={`duration-${d.weekday}`}>
                      Duração de {label.long}
                    </label>
                    <Select id={`duration-${d.weekday}`} value={String(d.duration)} onChange={(e) => setDayTime(d.weekday, { duration: Number(e.target.value) })}>
                      {DURATIONS.map((m) => (
                        <option key={m} value={m}>
                          {durationLabel(m)}
                          {addMinutes(d.start, m) ? ` (até ${endLabel(addMinutes(d.start, m)!)})` : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              })}
            </fieldset>
          ) : null}
          {recurring ? (
            <Field label="Repetir até (opcional)" hint={`A partir de ${DateTime.fromISO(firstDate).toFormat('dd/LL')}. Sem data, a série segue renovando.`} className="sm:col-span-2">
              {(id, describedBy) => <Input id={id} type="date" value={until} min={firstDate} aria-describedby={describedBy} onChange={(e) => setUntil(e.target.value)} />}
            </Field>
          ) : null}
          <ReminderOption className="sm:col-span-2 lg:hidden" checked={notifyHour} onChange={setNotifyHour} />
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

function ReminderOption({ className, checked, onChange }: { className?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <fieldset className={className}>
      <legend className="mb-1 text-sm font-medium">Lembrete</legend>
      <Checkbox label="Avisar o responsável 1h antes" checked={checked} onChange={onChange} />
      <p className="text-xs text-muted-foreground">O responsável já recebe o aviso da véspera pelo WhatsApp.</p>
    </fieldset>
  );
}
