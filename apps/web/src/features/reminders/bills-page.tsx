import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronLeft, ChevronRight, Plus, ReceiptText } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { Input, Skeleton } from '@/components/ui/input';
import { api, apiSend, type BillOccurrence, type BillsSummary, canManage, type RecurringBill, type Reminder } from '@/lib/api';
import { centsToInput, formatBRL, formatCompetence, formatDueDate, local, parseBRL, shiftCompetence, todayIn, toZonedIso } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

const STATUS: Record<BillOccurrence['status'], { label: string; variant: 'active' | 'pending' | 'late' | 'archived' | 'neutral' }> = {
  paid: { label: '● Paga', variant: 'active' },
  partially_paid: { label: '◐ Parcial', variant: 'pending' },
  pending: { label: '◷ A vencer', variant: 'neutral' },
  overdue: { label: '! Atrasada', variant: 'late' },
  cancelled: { label: 'Cancelada', variant: 'archived' },
};

const CATEGORIES = [
  ['aluguel', 'Aluguel'],
  ['energia', 'Energia elétrica'],
  ['agua', 'Água'],
  ['internet', 'Internet'],
  ['telefone', 'Telefone'],
  ['outros', 'Outros'],
] as const;

function billNote(o: BillOccurrence): string {
  if (o.status === 'paid') return `Pago ${formatBRL(o.paidAmountCents)}`;
  if (o.expectedAmountCents === null) return 'Valor variável';
  if (o.status === 'partially_paid' || (o.status === 'overdue' && o.paidAmountCents > 0)) {
    return `${formatBRL(o.paidAmountCents)} pagos de ${formatBRL(o.expectedAmountCents)}`;
  }
  return `${formatBRL(o.expectedAmountCents)} previsto`;
}

export function BillsPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const admin = canManage(session?.user.role);
  const [competence, setCompetence] = useState(() => todayIn(tz).slice(0, 7));
  const [paying, setPaying] = useState<BillOccurrence | null>(null);
  const [newBill, setNewBill] = useState(false);
  const [newReminder, setNewReminder] = useState(false);

  const occurrences = useQuery({ queryKey: ['bills', 'occurrences', competence], queryFn: () => api<BillOccurrence[]>(`/bills/occurrences?competence=${competence}`) });
  const summary = useQuery({ queryKey: ['bills', 'summary', competence], queryFn: () => api<BillsSummary>(`/bills/summary?competence=${competence}`) });
  const bills = useQuery({ queryKey: ['bills', 'list'], queryFn: () => api<RecurringBill[]>('/bills') });
  const reminders = useQuery({ queryKey: ['reminders'], queryFn: () => api<Reminder[]>('/reminders') });

  return (
    <>
      <PageHeader
        eyebrow="Cuidados recorrentes"
        title="Contas e lembretes."
        description="A Coxia avisa um dia antes e acompanha cada mês."
        action={
          admin ? (
            <Button onClick={() => setNewBill(true)}>
              <Plus aria-hidden /> Nova conta
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => setCompetence(shiftCompetence(competence, -1))}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => setCompetence(shiftCompetence(competence, 1))}>
          <ChevronRight aria-hidden />
        </Button>
        <h2 className="ml-2 font-semibold first-letter:uppercase" aria-live="polite">
          {formatCompetence(competence)}
        </h2>
      </div>

      <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.data ? (
          <>
            <MetricCard highlight title="Previsto" value={formatBRL(summary.data.expectedCents)} caption={summary.data.variableWithoutAmount ? `+ ${summary.data.variableWithoutAmount} variável` : `${summary.data.total} contas`} />
            <MetricCard title="Pago" value={formatBRL(summary.data.paidCents)} caption={`${summary.data.paid} de ${summary.data.total}`} />
            <MetricCard title="Pendentes" value={String(summary.data.pending)} caption="A vencer ou parciais" />
            <MetricCard title="Atrasadas" value={String(summary.data.overdue)} caption={summary.data.overdue ? 'Precisam de atenção' : 'Tudo em dia'} />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)
        )}
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Obrigações do mês</CardTitle>
          <CardDescription>Competência: {formatCompetence(competence)}</CardDescription>
        </CardHeader>
        <CardContent>
          {occurrences.isPending ? (
            <Skeleton className="h-32" />
          ) : occurrences.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar as contas.
            </p>
          ) : occurrences.data.length === 0 ? (
            <EmptyState icon={ReceiptText} title="Nenhuma conta neste mês">
              As ocorrências são geradas automaticamente para o mês atual e o próximo.
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {occurrences.data.map((o) => {
                const due = formatDueDate(o.dueDate);
                const status = STATUS[o.status];
                return (
                  <li key={o.id} className="flex min-h-16 items-center gap-3 py-3">
                    <div className="grid w-12 shrink-0 place-items-center rounded-md bg-muted py-1 text-center leading-tight">
                      <span className="text-[11px] uppercase text-muted-foreground">{due.month}</span>
                      <span className="tabular text-lg font-semibold">{due.day}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{o.recurringBill.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{billNote(o)}</p>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    {admin && o.status !== 'paid' && o.status !== 'cancelled' ? (
                      <Button variant="outline" size="sm" onClick={() => setPaying(o)}>
                        Pagar
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contas cadastradas</CardTitle>
            <CardDescription>Vencimentos em dias 29–31 caem no último dia dos meses curtos</CardDescription>
          </CardHeader>
          <CardContent>
            <BillsList bills={bills.data ?? []} admin={admin} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Lembretes</CardTitle>
              <CardDescription>Avisos pelo WhatsApp no horário marcado</CardDescription>
            </div>
            {admin ? (
              <Button variant="outline" size="sm" onClick={() => setNewReminder(true)}>
                <Plus aria-hidden /> Novo
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {(reminders.data ?? []).filter((r) => r.active).length === 0 ? (
              <EmptyState icon={Bell} title="Nenhum lembrete ativo">
                Crie lembretes únicos ou semanais para a equipe.
              </EmptyState>
            ) : (
              <ul className="divide-y">
                {(reminders.data ?? [])
                  .filter((r) => r.active)
                  .map((r) => (
                    <li key={r.id} className="flex min-h-14 items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {r.nextRunAt ? local(r.nextRunAt, tz).toFormat("dd/LL 'às' HH:mm") : '—'}
                          {r.kind === 'recurring' ? ' · semanal' : ''}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {paying ? <PaymentDialog occ={paying} tz={tz} onClose={() => setPaying(null)} /> : null}
      {newBill ? <BillDialog tz={tz} onClose={() => setNewBill(false)} /> : null}
      {newReminder ? <ReminderDialog tz={tz} onClose={() => setNewReminder(false)} /> : null}
    </>
  );
}

function BillsList({ bills, admin }: { bills: RecurringBill[]; admin: boolean }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (b: RecurringBill) => apiSend(`/bills/${b.id}/${b.active ? 'suspend' : 'reactivate'}`, 'POST'),
    onSuccess: (_d, b) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success(b.active ? `${b.name} suspensa: sem novos avisos.` : `${b.name} reativada.`);
    },
    onError: (e) => toast.error(e.message),
  });
  if (bills.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>;
  return (
    <ul className="divide-y">
      {bills.map((b) => (
        <li key={b.id} className="flex min-h-14 items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{b.name}</p>
            <p className="text-sm text-muted-foreground">
              Dia {b.dueDay} · {b.isVariableAmount || b.estimatedAmountCents === null ? 'valor variável' : formatBRL(b.estimatedAmountCents)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!b.active ? <Badge variant="archived">Suspensa</Badge> : null}
            {admin ? (
              <Button variant="ghost" size="sm" loading={toggle.isPending && toggle.variables?.id === b.id} onClick={() => toggle.mutate(b)}>
                {b.active ? 'Suspender' : 'Reativar'}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PaymentDialog({ occ, tz, onClose }: { occ: BillOccurrence; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const remaining = occ.expectedAmountCents === null ? null : occ.expectedAmountCents - occ.paidAmountCents;
  const [amount, setAmount] = useState(remaining === null ? '' : centsToInput(remaining));
  const [paidOn, setPaidOn] = useState(todayIn(tz));
  const [error, setError] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: (cents: number) => apiSend(`/bills/occurrences/${occ.id}/payments`, 'POST', { amountCents: cents, paidOn }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Pagamento registrado.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0) return setError('Informe um valor válido, ex.: 310,00');
    pay.mutate(cents);
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Registrar pagamento — ${occ.recurringBill.name}`}
      description={`Competência ${formatCompetence(occ.competence)}${remaining !== null ? ` · em aberto ${formatBRL(remaining)}` : ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="payment-form" loading={pay.isPending}>
            Confirmar pagamento
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Valor pago (R$)" error={error} hint="Valor menor que o previsto fica como pagamento parcial">
          {(id, describedBy) => (
            <Input id={id} inputMode="decimal" className="tabular" value={amount} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => setAmount(e.target.value)} />
          )}
        </Field>
        <Field label="Data do pagamento">{(id) => <Input id={id} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
        <p className="text-sm text-muted-foreground">Comprovantes enviados pelo WhatsApp são anexados automaticamente.</p>
      </form>
    </Dialog>
  );
}

function BillDialog({ tz, onClose }: { tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('outros');
  const [dueDay, setDueDay] = useState('10');
  const [amount, setAmount] = useState('');
  const [variable, setVariable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: unknown) => apiSend('/bills', 'POST', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success('Conta cadastrada; ocorrências do mês geradas.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const day = Number(dueDay);
    const cents = amount ? parseBRL(amount) : null;
    if (!name.trim()) return setError('Informe o nome.');
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError('Dia de vencimento entre 1 e 31.');
    if (amount && cents === null) return setError('Valor inválido.');
    create.mutate({
      name,
      category,
      dueDay: day,
      estimatedAmountCents: variable ? null : cents,
      isVariableAmount: variable,
      startsOn: `${todayIn(tz).slice(0, 7)}-01`,
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Nova conta mensal"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="bill-form" loading={create.isPending}>
            Cadastrar
          </Button>
        </>
      }
    >
      <form id="bill-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Nome" className="sm:col-span-2">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Energia elétrica" />}
        </Field>
        <Field label="Categoria">
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Dia do vencimento">{(id) => <Input id={id} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />}</Field>
        <div className="sm:col-span-2">
          <Checkbox label="Valor variável (informado a cada pagamento)" checked={variable} onChange={setVariable} />
        </div>
        {!variable ? (
          <Field label="Valor estimado (R$)" className="sm:col-span-2">
            {(id) => <Input id={id} inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />}
          </Field>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function ReminderDialog({ tz, onClose }: { tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIn(tz));
  const [time, setTime] = useState('09:00');
  const [phones, setPhones] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: unknown) => apiSend('/reminders', 'POST', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      toast.success('Lembrete criado.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const recipientPhones = phones.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
    if (!title.trim()) return setError('Informe o título.');
    if (recipientPhones.length === 0) return setError('Informe ao menos um WhatsApp.');
    const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    create.mutate({
      title,
      dueAt: toZonedIso(date, time, tz),
      recurrenceRule: weekly ? `FREQ=WEEKLY;BYDAY=${days[(weekday + 6) % 7]}` : null,
      recipientPhones,
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Novo lembrete"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="reminder-form" loading={create.isPending}>
            Criar
          </Button>
        </>
      }
    >
      <form id="reminder-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Título" className="sm:col-span-2">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Renovar alvará" />}
        </Field>
        <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Hora">{(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        <Field label="WhatsApp dos destinatários" hint="Separe vários por vírgula" className="sm:col-span-2">
          {(id, describedBy) => <Input id={id} inputMode="tel" value={phones} aria-describedby={describedBy} onChange={(e) => setPhones(e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label="Repetir toda semana" checked={weekly} onChange={setWeekly} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
