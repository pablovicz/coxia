import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileText, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@coxia/ui/components/ui/card';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field, Select } from '@coxia/ui/components/ui/field';
import { Input, Skeleton, Textarea } from '@coxia/ui/components/ui/input';
import { centsToInput, formatBRL, formatCompetence, local, parseBRL, todayIn } from '@coxia/ui/lib/format';
import { RoomIcon, roomStyle } from '@coxia/ui/lib/rooms';
import {
  ApiBodyError,
  api,
  apiSend,
  type ContractBalance,
  type CycleBalance,
  fetchContractFile,
  formatHours,
  type LedgerEntry,
  type ResidentContract,
  type Space,
  uploadContractFile,
} from '@/lib/api';
import { useCheckInEnabled } from '@/providers/auth-provider';

const brDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const brDayMonth = (iso: string) => iso.slice(5, 10).split('-').reverse().join('/');

/** "10", "10h", "10:30", "10h30", "10,5" → minutos (múltiplo de 30) ou null. */
export function parseHours(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s/g, '');
  if (!s) return null;
  const hm = /^(\d{1,3})(?:[h:](\d{2})?)?$/.exec(s);
  let minutes: number | null = null;
  if (hm) minutes = Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
  else if (/^\d{1,3}[,.]\d+$/.test(s)) minutes = Math.round(Number(s.replace(',', '.')) * 60);
  if (minutes === null || minutes % 30 !== 0) return null;
  return minutes;
}

function CycleLine({ b, label }: { b: CycleBalance; label: string }) {
  const total = Math.max(b.grantedMinutes + b.adjustedMinutes, b.usedMinutes + b.reservedMinutes, 1);
  const pct = (m: number) => `${Math.max(0, Math.min(100, (m / total) * 100))}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={b.availableMinutes < 0 ? 'tabular font-semibold text-destructive' : 'tabular font-semibold'}>{formatHours(b.availableMinutes)} disponíveis</span>
      </div>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="room-fill h-full" style={{ width: pct(b.usedMinutes) }} />
        <div className="room-soft h-full" style={{ width: pct(b.reservedMinutes) }} />
      </div>
      {b.payment?.status === 'pending' && b.grantedMinutes === 0 ? (
        <p className="mt-1 text-xs font-medium text-warning dark:text-warning">Horas liberadas quando a mensalidade (vence {brDayMonth(b.payment.dueOn)}) for marcada como paga.</p>
      ) : b.payment?.status === 'none' && b.grantedMinutes === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Sem mensalidade neste ciclo: sem horas (começam no próximo ciclo pago).</p>
      ) : null}
      <p className="tabular mt-1 text-xs text-muted-foreground">
        {formatHours(b.grantedMinutes)} do ciclo{b.adjustedMinutes ? ` ${b.adjustedMinutes > 0 ? '+' : ''}${formatHours(b.adjustedMinutes)} ajuste` : ''} · {formatHours(b.usedMinutes)} usadas · {formatHours(b.reservedMinutes)} reservadas · renova {brDayMonth(b.renewsOn)}
      </p>
    </div>
  );
}

export function ContractForm({ residentId, contract, onClose }: { residentId: string; contract?: ResidentContract; onClose: () => void }) {
  const qc = useQueryClient();
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') });
  const [spaceId, setSpaceId] = useState(contract?.spaceId ?? '');
  const [hours, setHours] = useState(contract ? formatHours(contract.monthlyMinutes).replace('h', ':').replace(/:$/, '') : '');
  const [amount, setAmount] = useState(contract?.monthlyAmountCents ? centsToInput(contract.monthlyAmountCents) : '');
  const [dueDay, setDueDay] = useState(contract?.paymentDueDay ? String(contract.paymentDueDay) : '');
  const [cycleDay, setCycleDay] = useState(String(contract?.cycleDay ?? 1));
  const [opensDay, setOpensDay] = useState(String(contract?.bookingOpensDay ?? 25));
  const [startsOn, setStartsOn] = useState(contract?.startsOn.slice(0, 10) ?? todayIn('America/Sao_Paulo'));
  const [endsOn, setEndsOn] = useState(contract?.endsOn?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(contract?.notes ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bookable = (spaces.data ?? []).filter((s) => s.status !== 'monthly_rental' || s.id === contract?.spaceId);

  const save = useMutation({
    mutationFn: async () => {
      const minutes = parseHours(hours);
      if (!spaceId) throw new Error('Escolha a sala');
      if (!minutes) throw new Error('Horas por mês em blocos de 30 min (ex.: 20 ou 12:30)');
      const cents = amount.trim() ? parseBRL(amount) : null;
      if (amount.trim() && !cents) throw new Error('Valor da mensalidade inválido');
      const body = {
        spaceId,
        monthlyMinutes: minutes,
        monthlyAmountCents: cents,
        paymentDueDay: dueDay ? Number(dueDay) : null,
        cycleDay: Number(cycleDay),
        bookingOpensDay: Number(opensDay),
        startsOn,
        endsOn: endsOn || null,
        notes: notes.trim() || null,
      };
      const saved = contract ? await apiSend<ResidentContract>(`/contracts/${contract.id}`, 'PATCH', body) : await apiSend<ResidentContract>(`/residents/${residentId}/contracts`, 'POST', body);
      if (file) await uploadContractFile(saved.id, file);
      return saved;
    },
    onSuccess: () => {
      toast.success(contract ? 'Contrato atualizado. As mudanças valem a partir do próximo ciclo.' : 'Contrato criado.');
      void qc.invalidateQueries({ queryKey: ['contracts', residentId] });
      void qc.invalidateQueries({ queryKey: ['resident', residentId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Não foi possível salvar.'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      size="wide"
      title={contract ? 'Editar contrato' : 'Novo contrato de horas'}
      description={contract ? 'Mudanças de horas e mensalidade valem a partir do próximo ciclo.' : 'Horas por ciclo numa sala. As horas não acumulam de um ciclo para o outro.'}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="contract-form" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      }
    >
      <form id="contract-form" className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Sala" className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={spaceId} onChange={(e) => setSpaceId(e.target.value)} disabled={!!contract && !!contract.balance}>
              <option value="">Escolha…</option>
              {bookable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Horas por mês" hint="Blocos de 30 min: 20, 12:30…">
          {(id, d) => <Input id={id} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder="20" aria-describedby={d} />}
        </Field>
        <Field label="Mensalidade (R$)" hint="Gera a entrada prevista de cada mês no Financeiro">
          {(id, d) => <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="900,00" aria-describedby={d} />}
        </Field>
        <Field label="Renova o saldo todo dia" hint="Início de cada ciclo (29–31 caem no último dia em meses curtos)">
          {(id, d) => (
            <Select id={id} value={cycleDay} onChange={(e) => setCycleDay(e.target.value)} aria-describedby={d}>
              {days.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Agenda do próximo ciclo abre todo dia" hint="Dia de virada: a partir dele o residente já reserva o ciclo seguinte">
          {(id, d) => (
            <Select id={id} value={opensDay} onChange={(e) => setOpensDay(e.target.value)} aria-describedby={d}>
              {days.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Vencimento da mensalidade (dia)">
          {(id) => (
            <Select id={id} value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
              <option value="">No dia da renovação</option>
              {days.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">{(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
          <Field label="Fim (opcional)">{(id) => <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}</Field>
        </div>
        <Field label="Observações" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}
        </Field>
        <Field label="Arquivo do contrato (PDF ou foto, até 10 MB)" className="sm:col-span-2" hint={contract?.contractFileName ? `Atual: ${contract.contractFileName}` : undefined}>
          {(id, d) => <Input id={id} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-describedby={d} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function AdjustDialog({ contract, onClose }: { contract: ResidentContract; onClose: () => void }) {
  const qc = useQueryClient();
  const [sign, setSign] = useState<1 | -1>(1);
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [cycle, setCycle] = useState(contract.balance?.current.cycle ?? '');
  const [error, setError] = useState<string | null>(null);
  const cycles = [contract.balance?.current, contract.balance?.next].filter((c): c is CycleBalance => !!c);
  const adjust = useMutation({
    mutationFn: () => {
      const minutes = parseHours(hours);
      if (!minutes) throw new Error('Horas em blocos de 30 min (ex.: 2 ou 1:30)');
      if (!note.trim()) throw new Error('Informe o motivo');
      return apiSend(`/contracts/${contract.id}/adjustments`, 'POST', { minutes: sign * minutes, note: note.trim(), cycle });
    },
    onSuccess: () => {
      toast.success('Saldo ajustado.');
      void qc.invalidateQueries({ queryKey: ['contracts', contract.residentId] });
      void qc.invalidateQueries({ queryKey: ['contract', contract.id] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Não foi possível ajustar.'),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Ajustar saldo do ciclo"
      description={`${contract.space.name} · o ajuste vale só para o ciclo escolhido.`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={adjust.isPending} onClick={() => (setError(null), adjust.mutate())}>
            {sign > 0 ? 'Adicionar horas' : 'Remover horas'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de ajuste">
          {([1, -1] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={sign === s}
              onClick={() => setSign(s)}
              className={`min-h-11 rounded-md border text-sm font-medium ${sign === s ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
            >
              {s > 0 ? 'Aumentar' : 'Diminuir'}
            </button>
          ))}
        </div>
        {cycles.length > 1 ? (
          <Field label="Ciclo">
            {(id) => (
              <Select id={id} value={cycle} onChange={(e) => setCycle(e.target.value)}>
                {cycles.map((c) => (
                  <option key={c.cycle} value={c.cycle}>
                    {formatCompetence(c.cycle)} ({formatHours(c.availableMinutes)} disponíveis)
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Horas">{(id) => <Input id={id} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder="2" />}</Field>
        <Field label="Motivo" hint="Aparece no extrato do residente">
          {(id, d) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} aria-describedby={d} placeholder="Ex.: sala fechada para manutenção" />}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function ledgerLabel(e: LedgerEntry, checkIn: boolean) {
  if (e.kind === 'monthly') return 'Horas do ciclo';
  if (e.kind === 'adjustment') return `Ajuste${e.note ? ` — ${e.note}` : ''}`;
  // Sem check-in, a reserva é debitada no horário: só "agendada" ou "realizada".
  if (!checkIn) return e.attendance === 'checked_in' || e.attendance === 'no_show' ? 'Reserva · realizada' : 'Reserva';
  return { upcoming: 'Reserva', in_progress: 'Reserva (agora)', checked_in: 'Reserva · check-in', no_show: 'Reserva · sem check-in' }[e.attendance ?? 'upcoming'];
}

function StatementDialog({ contract, tz, onClose }: { contract: ResidentContract; tz: string; onClose: () => void }) {
  const checkIn = useCheckInEnabled();
  const q = useQuery({ queryKey: ['contract', contract.id], queryFn: () => api<ContractBalance>(`/contracts/${contract.id}`) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Extrato de horas" description={contract.space.name} size="wide">
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-6" style={roomStyle(contract.space.color)}>
          {(q.data?.cycles ?? []).map((c) => (
            <section key={c.cycle}>
              <CycleLine b={c} label={`Ciclo de ${formatCompetence(c.cycle)}`} />
              <ul className="mt-3 divide-y text-sm">
                {c.ledger.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      <span className="tabular mr-2 text-muted-foreground">{local(e.at, tz).toFormat(e.kind === 'booking' ? 'dd/MM HH:mm' : 'dd/MM')}</span>
                      {ledgerLabel(e, checkIn)}
                    </span>
                    <span className={`tabular shrink-0 font-medium ${e.minutes < 0 ? 'text-muted-foreground' : 'text-success'}`}>
                      {e.minutes > 0 ? '+' : ''}
                      {formatHours(e.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function EndDialog({ contract, onClose }: { contract: ResidentContract; onClose: () => void }) {
  const qc = useQueryClient();
  const [endsOn, setEndsOn] = useState(todayIn('America/Sao_Paulo'));
  const end = useMutation({
    mutationFn: () => apiSend(`/contracts/${contract.id}/end`, 'POST', { endsOn }),
    onSuccess: () => {
      toast.success('Contrato encerrado.');
      void qc.invalidateQueries({ queryKey: ['contracts', contract.residentId] });
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiBodyError ? err.message : 'Não foi possível encerrar.'),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Encerrar contrato?"
      description="As reservas e mensalidades previstas depois do fim são canceladas (o residente recebe o cancelamento por e-mail)."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="destructive" loading={end.isPending} onClick={() => end.mutate()}>
            Encerrar
          </Button>
        </div>
      }
    >
      <Field label="Último dia do contrato">{(id) => <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}</Field>
    </Dialog>
  );
}

/** Seção "Contratos de horas" do detalhe do residente. */
export function ResidentContracts({ residentId, admin, tz }: { residentId: string; admin: boolean; tz: string }) {
  const q = useQuery({ queryKey: ['contracts', residentId], queryFn: () => api<ResidentContract[]>(`/residents/${residentId}/contracts`) });
  const [form, setForm] = useState<{ contract?: ResidentContract } | null>(null);
  const [adjusting, setAdjusting] = useState<ResidentContract | null>(null);
  const [statement, setStatement] = useState<ResidentContract | null>(null);
  const [ending, setEnding] = useState<ResidentContract | null>(null);

  async function openFile(c: ResidentContract) {
    const tab = window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await fetchContractFile(c.id));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      toast.error('Não foi possível abrir o arquivo.');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Contratos de horas</CardTitle>
          <CardDescription>Horas por ciclo, saldo e reservas pelo workspace do residente</CardDescription>
        </div>
        {admin ? (
          <Button size="sm" variant="outline" onClick={() => setForm({})}>
            <Plus aria-hidden /> Novo contrato
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState icon={FilePlus2} title="Nenhum contrato" action={admin ? <Button onClick={() => setForm({})}>Criar contrato</Button> : undefined}>
            Com um contrato, o residente reserva a sala pelo workspace usando o saldo de horas do mês.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-4">
            {(q.data ?? []).map((c) => (
              <li key={c.id} className="rounded-lg border p-4" style={roomStyle(c.space.color)}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="room-soft grid size-10 place-items-center rounded-md">
                      <RoomIcon icon={c.space.icon} size={20} className="room-text" aria-hidden />
                    </div>
                    <div>
                      <p className="font-semibold">{c.space.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatHours(c.monthlyMinutes)}/mês{c.monthlyAmountCents ? ` · ${formatBRL(c.monthlyAmountCents)}` : ''} · renova dia {c.cycleDay} · agenda abre dia {c.bookingOpensDay}
                      </p>
                    </div>
                  </div>
                  <Badge variant={c.status === 'active' ? 'active' : 'archived'}>{c.status === 'active' ? (c.endsOn ? `Até ${brDate(c.endsOn)}` : 'Vigente') : 'Encerrado'}</Badge>
                </div>
                {c.status === 'active' && c.balance ? (
                  <div className="mt-4 flex flex-col gap-3">
                    <CycleLine b={c.balance.current} label={`Ciclo de ${formatCompetence(c.balance.current.cycle)}`} />
                    {c.balance.next ? <CycleLine b={c.balance.next} label={`${formatCompetence(c.balance.next.cycle)} (agenda aberta)`} /> : null}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setStatement(c)}>
                    Extrato
                  </Button>
                  {c.contractUploadedAt ? (
                    <Button size="sm" variant="ghost" onClick={() => openFile(c)}>
                      <FileText aria-hidden /> Arquivo
                    </Button>
                  ) : null}
                  {admin && c.status === 'active' ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setAdjusting(c)}>
                        Ajustar saldo
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setForm({ contract: c })}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEnding(c)}>
                        Encerrar
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {form ? <ContractForm residentId={residentId} contract={form.contract} onClose={() => setForm(null)} /> : null}
      {adjusting ? <AdjustDialog contract={adjusting} onClose={() => setAdjusting(null)} /> : null}
      {statement ? <StatementDialog contract={statement} tz={tz} onClose={() => setStatement(null)} /> : null}
      {ending ? <EndDialog contract={ending} onClose={() => setEnding(null)} /> : null}
    </Card>
  );
}
