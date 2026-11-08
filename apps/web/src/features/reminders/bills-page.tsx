import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ChevronLeft, ChevronRight, Pencil, Plus, ReceiptText, Tags } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MetricCard,
} from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { Input, Skeleton } from '@/components/ui/input';
import {
  api,
  apiSend,
  type BillOccurrence,
  type BillsSummary,
  canManage,
  type Income,
  type IncomesSummary,
  type RecurringBill,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { IncomeDialog, IncomeList } from '@/features/finance/incomes';
import { CategoryBadge, ExpenseCategoriesDialog, useExpenseCategories } from '@/features/finance/expense-categories';
import { CategoryIcon } from '@/lib/expense-categories';
import { roomStyle } from '@/lib/rooms';
import {
  centsToInput,
  formatBRL,
  formatCompetence,
  formatDueDate,
  local,
  parseBRL,
  shiftCompetence,
  todayIn,
} from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

const STATUS: Record<
  BillOccurrence['status'],
  { label: string; variant: 'active' | 'pending' | 'late' | 'archived' | 'neutral' }
> = {
  paid: { label: '● Paga', variant: 'active' },
  partially_paid: { label: '◐ Parcial', variant: 'pending' },
  pending: { label: '◷ A vencer', variant: 'neutral' },
  overdue: { label: '! Atrasada', variant: 'late' },
  cancelled: { label: 'Cancelada', variant: 'archived' },
};

function billNote(o: BillOccurrence): string {
  if (o.status === 'paid') return `Pago ${formatBRL(o.paidAmountCents)}`;
  if (o.expectedAmountCents === null) return 'Valor variável';
  if (o.status === 'partially_paid' || (o.status === 'overdue' && o.paidAmountCents > 0)) {
    return `${formatBRL(o.paidAmountCents)} pagos de ${formatBRL(o.expectedAmountCents)}`;
  }
  if (o.recurringBill.isVariableAmount && o.paidAmountCents === 0)
    return `cerca de ${formatBRL(o.expectedAmountCents)} (variável)`;
  return `${formatBRL(o.expectedAmountCents)} previsto`;
}

export function BillsPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const admin = canManage(session?.user.role);
  const [competence, setCompetence] = useState(() => todayIn(tz).slice(0, 7));
  const [paying, setPaying] = useState<BillOccurrence | null>(null);
  // null = fechado; 'new' = cadastro; RecurringBill = edição.
  const [billForm, setBillForm] = useState<RecurringBill | 'new' | null>(null);
  const [incomeForm, setIncomeForm] = useState<Income | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'entradas' ? 'entradas' : 'contas';
  const setTab = (t: 'contas' | 'entradas') =>
    setParams(t === 'contas' ? {} : { aba: t }, { replace: true });

  const occurrences = useQuery({
    queryKey: ['bills', 'occurrences', competence],
    queryFn: () => api<BillOccurrence[]>(`/bills/occurrences?competence=${competence}`),
  });
  const summary = useQuery({
    queryKey: ['bills', 'summary', competence],
    queryFn: () => api<BillsSummary>(`/bills/summary?competence=${competence}`),
  });
  const bills = useQuery({
    queryKey: ['bills', 'list'],
    queryFn: () => api<RecurringBill[]>('/bills'),
  });
  const incomes = useQuery({
    queryKey: ['incomes', 'list', competence],
    queryFn: () => api<Income[]>(`/incomes?competence=${competence}`),
  });
  const incomeSummary = useQuery({
    queryKey: ['incomes', 'summary', competence],
    queryFn: () => api<IncomesSummary>(`/incomes/summary?competence=${competence}`),
  });
  const out = summary.data;
  const inc = incomeSummary.data;

  return (
    <>
      <PageHeader
        eyebrow="Dinheiro da casa"
        title="Financeiro."
        description="Entradas e saídas do mês: contas a pagar e o que vem de projetos e aluguéis das salas."
        action={
          admin ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
                <Tags aria-hidden /> Categorias
              </Button>
              <Button variant="outline" onClick={() => setIncomeForm('new')}>
                <ArrowDownLeft aria-hidden /> Nova entrada
              </Button>
              <Button onClick={() => setBillForm('new')}>
                <Plus aria-hidden /> Nova conta
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Mês anterior"
          onClick={() => setCompetence(shiftCompetence(competence, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Próximo mês"
          onClick={() => setCompetence(shiftCompetence(competence, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
        <h2 className="ml-2 font-semibold first-letter:uppercase" aria-live="polite">
          {formatCompetence(competence)}
        </h2>
      </div>

      <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {out && inc ? (
          <>
            <MetricCard
              compact
              title="Entradas"
              value={formatBRL(inc.expectedCents)}
              caption={`${formatBRL(inc.receivedCents)} recebidos`}
            />
            <MetricCard
              compact
              title="Saídas"
              value={formatBRL(out.expectedCents)}
              caption={`${formatBRL(out.paidCents)} pagos${out.variableWithoutAmount ? ` · + ${out.variableWithoutAmount} variável` : ''}`}
            />
            <MetricCard
              compact
              highlight
              title="Saldo previsto"
              value={formatBRL(inc.expectedCents - out.expectedCents)}
              caption="Entradas menos saídas do mês"
            />
            <MetricCard
              title="Atrasadas"
              value={String(out.overdue + inc.overdue)}
              caption={
                out.overdue + inc.overdue
                  ? `${out.overdue} conta${out.overdue === 1 ? '' : 's'} · ${inc.overdue} entrada${inc.overdue === 1 ? '' : 's'}`
                  : 'Tudo em dia'
              }
            />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)
        )}
      </section>

      <div
        role="tablist"
        aria-label="Entradas e saídas"
        className="mt-6 grid grid-cols-2 gap-1 rounded-md border bg-card p-1 sm:inline-grid sm:w-auto"
      >
        {(
          [
            ['contas', `Contas a pagar${occurrences.data ? ` (${occurrences.data.length})` : ''}`],
            ['entradas', `Entradas${incomes.data ? ` (${incomes.data.length})` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              'min-h-11 rounded-sm px-4 text-sm font-medium text-muted-foreground lg:min-h-9',
              tab === id && 'bg-primary text-primary-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'entradas' ? (
        <Card id="panel-entradas" role="tabpanel" aria-labelledby="tab-entradas" className="mt-4">
          <CardHeader>
            <CardTitle>Entradas do mês</CardTitle>
            <CardDescription>
              Projetos, aluguéis das salas e outras. O aluguel mensal das salas alugadas entra
              sozinho.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {incomes.isPending ? (
              <Skeleton className="h-32" />
            ) : incomes.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Não foi possível carregar as entradas.
              </p>
            ) : incomes.data.length === 0 ? (
              <EmptyState icon={ArrowDownLeft} title="Nenhuma entrada neste mês">
                Lance o que vem dos projetos (patrocínio, parcelas, bilheteria) com a data prevista.
                Salas alugadas geram o aluguel do mês sozinhas.
              </EmptyState>
            ) : (
              <IncomeList
                items={incomes.data}
                tz={tz}
                admin={admin}
                onEdit={(i) => setIncomeForm(i)}
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <div id="panel-contas" role="tabpanel" aria-labelledby="tab-contas">
          <Card className="mt-4">
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
                          <span className="text-[11px] uppercase text-muted-foreground">
                            {due.month}
                          </span>
                          <span className="tabular text-lg font-semibold">{due.day}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{o.recurringBill.name}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            {billNote(o)}
                            {o.status === 'overdue' && o.recurringBill.lateFeeCents
                              ? ` + multa ${formatBRL(o.recurringBill.lateFeeCents)}`
                              : ''}
                          </p>
                          <span className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
                            <CategoryBadge category={o.recurringBill.expenseCategory} />
                            {o.recurringBill.kind === 'one_time' ? (
                              <Badge variant="neutral">Pontual</Badge>
                            ) : null}
                          </span>
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

          {occurrences.data?.length ? <ByCategory occurrences={occurrences.data} /> : null}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Contas mensais cadastradas</CardTitle>
              <CardDescription>
                Vencimentos em dias 29–31 caem no último dia dos meses curtos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BillsList
                bills={(bills.data ?? []).filter((b) => b.kind !== 'one_time')}
                admin={admin}
                onEdit={(b) => setBillForm(b)}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {paying ? <PaymentDialog occ={paying} tz={tz} onClose={() => setPaying(null)} /> : null}
      {categoriesOpen ? <ExpenseCategoriesDialog onClose={() => setCategoriesOpen(false)} /> : null}
      {incomeForm ? (
        <IncomeDialog
          tz={tz}
          income={incomeForm === 'new' ? null : incomeForm}
          onClose={() => setIncomeForm(null)}
        />
      ) : null}
      {billForm ? (
        <BillDialog
          tz={tz}
          bill={billForm === 'new' ? null : billForm}
          onClose={() => setBillForm(null)}
        />
      ) : null}
    </>
  );
}

/** "R$ 149,90", "cerca de R$ 300,00 (variável)" ou "valor variável". */
export function billAmountLabel(
  b: Pick<RecurringBill, 'isVariableAmount' | 'estimatedAmountCents'>,
): string {
  if (b.estimatedAmountCents === null) return 'valor variável';
  return b.isVariableAmount
    ? `cerca de ${formatBRL(b.estimatedAmountCents)} (variável)`
    : formatBRL(b.estimatedAmountCents);
}

function BillsList({
  bills,
  admin,
  onEdit,
}: {
  bills: RecurringBill[];
  admin: boolean;
  onEdit: (b: RecurringBill) => void;
}) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (b: RecurringBill) =>
      apiSend(`/bills/${b.id}/${b.active ? 'suspend' : 'reactivate'}`, 'POST'),
    onSuccess: (_d, b) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success(b.active ? `${b.name} suspensa: sem novos avisos.` : `${b.name} reativada.`);
    },
    onError: (e) => toast.error(e.message),
  });
  if (bills.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>;
  return (
    <ul className="divide-y">
      {bills.map((b) => (
        <li key={b.id} className="flex min-h-14 items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{b.name}</p>
            <p className="text-sm text-muted-foreground">
              Dia {b.dueDay} · {billAmountLabel(b)}
              {b.lateFeeCents ? ` · multa ${formatBRL(b.lateFeeCents)}` : ''}
            </p>
            <CategoryBadge category={b.expenseCategory} className="mt-1" />
          </div>
          <div className="flex items-center gap-2">
            {!b.active ? <Badge variant="archived">Suspensa</Badge> : null}
            {admin ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(b)}
                  aria-label={`Editar ${b.name}`}
                >
                  <Pencil aria-hidden /> <span className="hidden sm:inline">Editar</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={toggle.isPending && toggle.variables?.id === b.id}
                  onClick={() => toggle.mutate(b)}
                >
                  {b.active ? 'Suspender' : 'Reativar'}
                </Button>
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PaymentDialog({
  occ,
  tz,
  onClose,
}: {
  occ: BillOccurrence;
  tz: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fee = occ.status === 'overdue' ? (occ.recurringBill.lateFeeCents ?? 0) : 0;
  const remaining =
    occ.expectedAmountCents === null ? null : occ.expectedAmountCents - occ.paidAmountCents + fee;
  const [amount, setAmount] = useState(remaining === null ? '' : centsToInput(remaining));
  const [paidOn, setPaidOn] = useState(todayIn(tz));
  const [error, setError] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: (cents: number) =>
      apiSend(`/bills/occurrences/${occ.id}/payments`, 'POST', { amountCents: cents, paidOn }),
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
        <Field
          label="Valor pago (R$)"
          error={error}
          hint="Valor menor que o previsto fica como pagamento parcial"
        >
          {(id, describedBy) => (
            <Input
              id={id}
              inputMode="decimal"
              className="tabular"
              value={amount}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Data do pagamento">
          {(id) => (
            <Input id={id} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          )}
        </Field>
        <p className="text-sm text-muted-foreground">
          Comprovantes enviados pelo WhatsApp são anexados automaticamente.
        </p>
      </form>
    </Dialog>
  );
}

function BillDialog({ tz, bill, onClose }: { tz: string; bill: RecurringBill | null; onClose: () => void }) {
  const qc = useQueryClient();
  const categories = useExpenseCategories();
  const [kind, setKind] = useState<'monthly' | 'one_time'>(bill?.kind ?? 'monthly');
  const [name, setName] = useState(bill?.name ?? '');
  const [categoryId, setCategoryId] = useState(bill?.expenseCategoryId ?? '');
  const [dueDay, setDueDay] = useState(String(bill?.dueDay ?? 10));
  const [dueOn, setDueOn] = useState(bill?.kind === 'one_time' && bill.startsOn ? bill.startsOn.slice(0, 10) : todayIn(tz));
  const [amount, setAmount] = useState(bill?.estimatedAmountCents != null ? centsToInput(bill.estimatedAmountCents) : '');
  const [lateFee, setLateFee] = useState(bill?.lateFeeCents != null ? centsToInput(bill.lateFeeCents) : '');
  const [variable, setVariable] = useState(bill?.kind === 'one_time' ? bill.isVariableAmount : false);
  const [manage, setManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Categoria padrão: a primeira (Casa) num cadastro novo.
  const effectiveCategory = categoryId || (!bill ? (categories.data?.[0]?.id ?? '') : '');

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (bill ? apiSend(`/bills/${bill.id}`, 'PATCH', body) : apiSend('/bills', 'POST', body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
      toast.success(bill ? 'Conta atualizada; as contas em aberto foram ajustadas.' : kind === 'one_time' ? 'Lançamento registrado.' : 'Conta cadastrada; lembretes automáticos ativados.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = amount.trim() ? parseBRL(amount) : null;
    const fee = lateFee.trim() ? parseBRL(lateFee) : null;
    if (!name.trim()) return setError('Informe o nome.');
    if (amount.trim() && cents === null) return setError('Valor inválido. Use, por exemplo, 149,90.');
    if (lateFee.trim() && fee === null) return setError('Multa inválida. Use, por exemplo, 25,00.');
    if (kind === 'monthly') {
      const day = Number(dueDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) return setError('Dia de vencimento entre 1 e 31.');
      if (!cents) return setError('Informe o valor fixo da conta mensal.');
      return save.mutate({
        kind,
        name: name.trim(),
        expenseCategoryId: effectiveCategory || null,
        dueDay: day,
        estimatedAmountCents: cents,
        isVariableAmount: false,
        lateFeeCents: fee,
        ...(bill ? {} : { startsOn: `${todayIn(tz).slice(0, 7)}-01` }),
      });
    }
    if (!dueOn) return setError('Informe a data do lançamento.');
    if (!variable && !cents) return setError('Informe o valor (ou marque valor variável).');
    save.mutate({
      kind,
      name: name.trim(),
      expenseCategoryId: effectiveCategory || null,
      dueOn,
      dueDay: Number(dueOn.slice(8, 10)),
      estimatedAmountCents: cents,
      isVariableAmount: variable,
      ...(bill ? {} : { startsOn: dueOn }),
    });
  }

  if (manage) return <ExpenseCategoriesDialog onClose={() => setManage(false)} />;

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={bill ? `Editar ${bill.name}` : 'Nova conta'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="bill-form" loading={save.isPending}>
            {bill ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form id="bill-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
          <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-1 rounded-md border bg-card p-1">
            {(
              [
                ['monthly', 'Mensal', 'Vence todo mês'],
                ['one_time', 'Outros', 'Lançamento numa data'],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                disabled={!!bill && bill.kind !== undefined && (bill.kind ?? 'monthly') !== value}
                onClick={() => setKind(value)}
                className={cn(
                  'flex min-h-11 flex-col items-center justify-center rounded-sm px-2 py-1 text-sm font-medium text-muted-foreground disabled:opacity-40',
                  kind === value && 'bg-primary text-primary-foreground',
                )}
              >
                {label}
                <span className={cn('text-[11px] font-normal', kind === value ? 'opacity-85' : 'text-muted-foreground')}>{hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Nome" className="sm:col-span-2">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'monthly' ? 'Ex.: Aluguel, Internet' : 'Ex.: Compra de copos'} />
          )}
        </Field>
        <Field label="Categoria" className="sm:col-span-2">
          {(id) => (
            <div className="flex gap-2">
              <Select id={id} value={effectiveCategory} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Sem categoria</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button variant="outline" onClick={() => setManage(true)} aria-label="Gerenciar categorias">
                <Tags aria-hidden />
              </Button>
            </div>
          )}
        </Field>

        {kind === 'monthly' ? (
          <>
            <Field label="Dia do vencimento">{(id) => <Input id={id} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />}</Field>
            <Field label="Valor (R$)">
              {(id) => <Input id={id} inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />}
            </Field>
            <Field label="Multa por atraso (R$, opcional)" hint="Somada ao valor quando a conta vence sem pagamento" className="sm:col-span-2">
              {(id, describedBy) => (
                <Input id={id} inputMode="decimal" className="tabular" value={lateFee} aria-describedby={describedBy} onChange={(e) => setLateFee(e.target.value)} placeholder="0,00" />
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label="Data">{(id) => <Input id={id} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}</Field>
            <Field label={variable ? 'Valor estimado (R$, opcional)' : 'Valor (R$)'}>
              {(id) => <Input id={id} inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />}
            </Field>
            <div className="sm:col-span-2">
              <Checkbox label="Valor variável (informado no pagamento)" checked={variable} onChange={setVariable} />
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Quanto foi previsto e pago no mês, por categoria. */
function ByCategory({ occurrences }: { occurrences: BillOccurrence[] }) {
  const groups = new Map<string, { category: BillOccurrence['recurringBill']['expenseCategory']; expected: number; paid: number }>();
  for (const o of occurrences) {
    if (o.status === 'cancelled') continue;
    const key = o.recurringBill.expenseCategory?.id ?? 'none';
    const g = groups.get(key) ?? { category: o.recurringBill.expenseCategory ?? null, expected: 0, paid: 0 };
    g.expected += Math.max(o.expectedAmountCents ?? 0, o.paidAmountCents);
    g.paid += o.paidAmountCents;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.expected - a.expected);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Por categoria</CardTitle>
        <CardDescription>Previsto e pago no mês</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.category?.id ?? 'none'}
              style={roomStyle(r.category?.color ?? 'grafite')}
              className="room-bar flex items-center gap-3 rounded-md border bg-card px-3 py-2.5"
            >
              <CategoryIcon icon={r.category?.icon ?? 'outros'} size={18} className="room-text shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.category?.name ?? 'Sem categoria'}</span>
              <span className="tabular shrink-0 text-sm text-muted-foreground">
                {formatBRL(r.paid)} de {formatBRL(r.expected)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
