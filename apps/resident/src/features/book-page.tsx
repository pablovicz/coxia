import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Checkbox, Field, Select } from '@coxia/ui/components/ui/field';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatCompetence, formatDayTitle, local, shiftDate, todayIn, weekDays } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { RoomTitle } from '@/components/balance';
import { ApiBodyError, api, apiSend, type Availability, brDayMonth, type Conflict, hours } from '@/lib/api';
import { useAuth, useTimezone } from '@/providers/auth';

const STEP = 30;
const MIN = 60;

interface Slot {
  start: DateTime;
  /** Até onde dá para estender sem bater em outra reserva ou no fechamento. */
  freeUntil: DateTime;
}

/** Inícios possíveis (de 30 em 30 min) nos intervalos livres do dia, a partir de agora. */
export function slotsOf(free: Array<{ start: string; end: string }>, tz: string, now: DateTime): Slot[] {
  const out: Slot[] = [];
  for (const i of free) {
    const end = DateTime.fromISO(i.end).setZone(tz);
    let s = DateTime.fromISO(i.start).setZone(tz);
    const rem = s.minute % STEP;
    if (rem || s.second || s.millisecond) s = s.set({ second: 0, millisecond: 0 }).plus({ minutes: rem ? STEP - rem : 0 });
    for (; s.plus({ minutes: MIN }) <= end; s = s.plus({ minutes: STEP })) {
      if (s < now) continue;
      out.push({ start: s, freeUntil: end });
    }
  }
  return out;
}

export function BookPage() {
  const { me } = useAuth();
  const tz = useTimezone();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const contracts = (me?.contracts ?? []).filter((c) => c.status === 'active');
  const contract = contracts.find((c) => c.id === params.get('contrato')) ?? contracts[0];
  const today = todayIn(tz);
  const [day, setDay] = useState(today);
  const [start, setStart] = useState<string | null>(null);
  const [duration, setDuration] = useState(MIN);
  const [weekly, setWeekly] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const week = weekDays(day, tz);
  const open = contract?.balance?.open ?? [];
  const bookableFrom = open[0]?.bookableFrom ?? today;
  const bookableUntil = open[open.length - 1]?.bookableUntil ?? today;
  const cycleOfDay = open.find((c) => c.bookableFrom <= day && day <= c.bookableUntil);
  // Contrato que só começa no próximo ciclo: abre no primeiro dia reservável.
  useEffect(() => {
    if (day < bookableFrom) setDay(bookableFrom);
  }, [day, bookableFrom]);

  const availability = useQuery({
    queryKey: ['availability', contract?.id, week[0]],
    queryFn: () => api<Availability>(`/me/contracts/${contract!.id}/availability?from=${week[0]}&to=${week[6]}`),
    enabled: !!contract,
  });

  // Ao trocar de dia (ou o horário ser ocupado por outra pessoa), a escolha anterior deixa de valer.
  const now = DateTime.now().setZone(tz);
  const slots = useMemo(() => {
    const d = availability.data?.days.find((x) => x.date === day);
    return d && cycleOfDay ? slotsOf(d.free, tz, now) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability.data, day, cycleOfDay?.key, tz]);
  const chosen = slots.find((s) => s.start.toISO() === start) ?? null;
  useEffect(() => {
    if (start && !chosen) setStart(null);
  }, [start, chosen]);

  const balance = cycleOfDay && contract?.balance ? (contract.balance.current.cycle === cycleOfDay.key ? contract.balance.current : contract.balance.next) : null;
  const available = balance?.availableMinutes ?? 0;
  const maxDuration = chosen ? Math.min(Math.floor(chosen.freeUntil.diff(chosen.start, 'minutes').minutes / STEP) * STEP, Math.floor(available / STEP) * STEP, 12 * 60) : 0;
  const durations = Array.from({ length: Math.max(0, (maxDuration - MIN) / STEP + 1) }, (_, i) => MIN + i * STEP);
  useEffect(() => {
    if (duration > maxDuration && maxDuration >= MIN) setDuration(maxDuration);
  }, [duration, maxDuration]);

  const weeksLeft = chosen && weekly && cycleOfDay ? Math.floor(DateTime.fromISO(cycleOfDay.bookableUntil).diff(chosen.start.startOf('day'), 'days').days / 7) + 1 : 1;

  const book = useMutation({
    mutationFn: (onConflict: 'fail' | 'skip') =>
      apiSend<{ occurrences: Array<{ id: string }>; skipped: Conflict[] }>('/me/bookings', 'POST', {
        contractId: contract!.id,
        startAt: chosen!.start.toISO({ suppressMilliseconds: true }),
        endAt: chosen!.start.plus({ minutes: duration }).toISO({ suppressMilliseconds: true }),
        repeatWeekly: weekly,
        onConflict,
      }),
    onSuccess: (res) => {
      const n = res.occurrences.length;
      toast.success(n > 1 ? `${n} reservas feitas. O convite de cada uma vai para o seu e-mail.` : 'Reserva feita. O convite vai para o seu e-mail.');
      if (res.skipped.length) toast.message(`${res.skipped.length} data(s) puladas por conflito.`);
      void qc.invalidateQueries();
      navigate('/reservas');
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

  if (!contract) {
    return (
      <>
        <PageHeader eyebrow="Reservar" title="Reservar sala" description="Escolha o dia e o horário." />
        <EmptyState icon={FileText} title="Nenhum contrato ativo">
          Sem contrato de horas ativo, não há sala para reservar.
        </EmptyState>
      </>
    );
  }

  const pick = (d: string) => {
    setDay(d);
    setStart(null);
    setConflicts(null);
    setError(null);
  };
  const canPrev = week[0]! > bookableFrom;
  const canNext = week[6]! < bookableUntil;

  return (
    <>
      <PageHeader eyebrow="Reservar" title="Reservar sala" description={`Agenda aberta até ${brDayMonth(bookableUntil)}. Blocos de 30 min, mínimo de 1 hora.`} />

      {contracts.length > 1 ? (
        <Field label="Contrato" className="mb-4">
          {(id) => (
            <Select
              id={id}
              value={contract.id}
              onChange={(e) => {
                setParams({ contrato: e.target.value });
                setStart(null);
              }}
            >
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.space.name} · {hours(c.monthlyMinutes)}/mês
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <Card className="p-4 sm:p-5" style={roomStyle(contract.space.color)}>
        <RoomTitle space={contract.space} subtitle={balance ? `${hours(available)} disponíveis no ciclo de ${formatCompetence(balance.cycle)}` : 'Escolha um dia dentro da agenda aberta'} />

        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" disabled={!canPrev} onClick={() => pick(shiftDate(week[0]!, -7) < bookableFrom ? bookableFrom : shiftDate(week[0]!, -7))} aria-label="Semana anterior">
            <ChevronLeft />
          </Button>
          <p className="text-sm font-medium capitalize">{local(week[0]!, tz).toFormat('LLLL yyyy')}</p>
          <Button variant="ghost" size="icon" disabled={!canNext} onClick={() => pick(shiftDate(week[0]!, 7))} aria-label="Próxima semana">
            <ChevronRight />
          </Button>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1" role="radiogroup" aria-label="Dia">
          {week.map((d) => {
            const disabled = d < bookableFrom || d > bookableUntil;
            const dt = DateTime.fromISO(d).setLocale('pt-BR');
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={d === day}
                aria-label={formatDayTitle(d)}
                disabled={disabled}
                onClick={() => pick(d)}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center rounded-md text-xs transition-colors disabled:opacity-35',
                  d === day ? 'room-fill font-semibold text-white' : 'hover:bg-muted',
                )}
              >
                <span className="uppercase">{dt.toFormat('ccc').replace('.', '')}</span>
                <span className="tabular text-base">{dt.toFormat('dd')}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <section className="mt-5" aria-labelledby="horarios">
        <h2 id="horarios" className="mb-3 font-semibold capitalize">
          {formatDayTitle(day)}
        </h2>
        {availability.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : !cycleOfDay ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Este dia está fora da agenda aberta.</p>
        ) : slots.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Sem horários livres neste dia.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Horário de início">
            {slots.map((s) => {
              const iso = s.start.toISO()!;
              return (
                <button
                  key={iso}
                  type="button"
                  role="radio"
                  aria-checked={start === iso}
                  onClick={() => {
                    setStart(iso);
                    setConflicts(null);
                    setError(null);
                  }}
                  className={cn('tabular min-h-11 rounded-md border text-sm font-medium transition-colors', start === iso ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
                >
                  {s.start.toFormat('HH:mm')}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {chosen ? (
        <Card className="mt-5 flex flex-col gap-4 p-5">
          {maxDuration < MIN ? (
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
              <Checkbox label={`Repetir toda ${chosen.start.setLocale('pt-BR').toFormat('cccc')} até ${brDayMonth(cycleOfDay!.bookableUntil)}`} checked={weekly} onChange={setWeekly} />
              <div className="rounded-md bg-muted px-4 py-3 text-sm">
                <p>
                  <strong className="capitalize">{chosen.start.setLocale('pt-BR').toFormat("cccc, dd/MM")}</strong>, {chosen.start.toFormat('HH:mm')}–{chosen.start.plus({ minutes: duration }).toFormat('HH:mm')}
                  {weekly && weeksLeft > 1 ? ` · ${weeksLeft} semanas` : ''}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Usa {hours(duration * weeksLeft)} do saldo{weekly && duration * weeksLeft > available ? ' (mais do que o disponível: algumas datas podem não caber)' : ''}. As horas saem do saldo ao reservar e voltam se você cancelar antes do início.
                </p>
              </div>
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
              <Button loading={book.isPending} onClick={() => book.mutate('fail')}>
                Confirmar reserva
              </Button>
            </>
          )}
        </Card>
      ) : null}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Dúvidas sobre o contrato? <Link to={`/contratos/${contract.id}`} className="underline underline-offset-4">Veja os termos e o extrato</Link>.
      </p>
    </>
  );
}
