import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ChevronLeft, ChevronRight, Paperclip, Pencil, Plus, ReceiptText, Tags, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { type FormEvent, useEffect, useState } from 'react';
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
import { Input, Skeleton, Textarea } from '@/components/ui/input';
import {
  api,
  apiSend,
  type BillDetails,
  type BillOccurrence,
  type BillsSummary,
  canManage,
  type Income,
  type IncomesSummary,
  MAX_PROOF_BYTES,
  PAYMENT_METHODS,
  type PaymentMethod,
  payWithProof,
  PROOF_TYPES,
  type RecurringBill,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { IncomeDialog, IncomeList } from '@/features/finance/incomes';
import { CategoryBadge, ExpenseCategoriesDialog, useExpenseCategories } from '@/features/finance/expense-categories';
import { BillDetailsDialog, BillsCalendar, CategoryFilter, type CategoryFilterValue, matchesCategory, UpcomingBills } from '@/features/finance/bills-views';
import { DateTime } from 'luxon';
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
  // Cada mês tem a própria página: /contas/AAAA-MM (a visão unificada fica em /contas).
  const { competence: routeCompetence } = useParams();
  const navigate = useNavigate();
  const currentMonth = todayIn(tz).slice(0, 7);
  const competence = routeCompetence && /^\d{4}-(0[1-9]|1[0-2])$/.test(routeCompetence) ? routeCompetence : currentMonth;
  const [paying, setPaying] = useState<BillOccurrence | null>(null);
  const [newPayment, setNewPayment] = useState(false);
  // null = fechado; 'new' = cadastro; RecurringBill = edição.
  const [billForm, setBillForm] = useState<RecurringBill | 'new' | null>(null);
  const [incomeForm, setIncomeForm] = useState<Income | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterValue>('all');
  const [billsView, setBillsView] = useState<'lista' | 'mes' | 'semana'>('lista');
  const [week, setWeek] = useState(() => DateTime.fromISO(competence === currentMonth ? todayIn(tz) : `${competence}-01`).startOf('week').toISODate()!);
  const [details, setDetails] = useState<{ billId: string; focus: BillOccurrence | null } | null>(null);
  const categoryList = useExpenseCategories();
  const openDetails = (o: BillOccurrence) => setDetails({ billId: o.recurringBill.id, focus: o });
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'entradas' ? 'entradas' : 'contas';
  // Trocou de mês pelas setas: a semana do calendário vai para a primeira semana do mês.
  useEffect(() => {
    if (DateTime.fromISO(week).plus({ days: 3 }).toFormat('yyyy-LL') !== competence) {
      setWeek(DateTime.fromISO(competence === currentMonth ? todayIn(tz) : `${competence}-01`).startOf('week').toISODate()!);
    }
  }, [competence]);
  const setCompetence = (c: string, replace = false) => navigate({ pathname: `/contas/${c}`, search: params.toString() ? `?${params}` : '' }, { replace });
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
      <Button variant="outline" asChild className="mb-4">
        <Link to="/contas">
          <ChevronLeft aria-hidden /> Voltar ao Financeiro
        </Link>
      </Button>
      <PageHeader
        eyebrow={competence === currentMonth ? 'Financeiro · mês atual' : 'Financeiro'}
        title={`${formatCompetence(competence).charAt(0).toUpperCase()}${formatCompetence(competence).slice(1)}.`}
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
              <Button variant="outline" onClick={() => setNewPayment(true)}>
                <Paperclip aria-hidden /> Adicionar pagamento
              </Button>
              <Button onClick={() => setBillForm('new')}>
                <Plus aria-hidden /> Nova conta
              </Button>
            </div>
          ) : null
        }
      />

      {competence === currentMonth ? <UpcomingBills tz={tz} filter={categoryFilter} onOpen={openDetails} /> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
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
          <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
            <div role="radiogroup" aria-label="Visão das contas" className="grid grid-cols-3 gap-1 rounded-md border bg-card p-1 lg:inline-grid">
              {(
                [
                  ['lista', 'Lista'],
                  ['mes', 'Mês'],
                  ['semana', 'Semana'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={billsView === id}
                  onClick={() => setBillsView(id)}
                  className={cn('min-h-11 rounded-sm px-4 text-sm font-medium text-muted-foreground lg:min-h-9', billsView === id && 'bg-primary text-primary-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
            <CategoryFilter categories={categoryList.data ?? []} value={categoryFilter} onChange={setCategoryFilter} />
          </div>
          {billsView !== 'lista' ? (
            <div className="mt-4">
              <BillsCalendar
                view={billsView}
                competence={competence}
                week={week}
                onWeekChange={(start) => {
                  setWeek(start);
                  // O resumo do mês acompanha a semana (o mês da quinta-feira).
                  setCompetence(DateTime.fromISO(start).plus({ days: 3 }).toFormat('yyyy-LL'), true);
                }}
                today={todayIn(tz)}
                filter={categoryFilter}
                onOpen={openDetails}
              />
            </div>
          ) : null}
          <Card className={cn('mt-4', billsView !== 'lista' && 'hidden')}>
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
              ) : occurrences.data.filter((o) => matchesCategory(o, categoryFilter)).length === 0 ? (
                <EmptyState icon={ReceiptText} title="Nenhuma conta neste mês">
                  As ocorrências são geradas automaticamente para o mês atual e o próximo.
                </EmptyState>
              ) : (
                <ul className="divide-y">
                  {occurrences.data.filter((o) => matchesCategory(o, categoryFilter)).map((o) => {
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
                          <button type="button" onClick={() => openDetails(o)} className="-my-3 block min-h-11 max-w-full truncate text-left font-medium leading-[2.75rem] underline-offset-4 hover:underline">
                            {o.recurringBill.name}
                          </button>
                          {o.recurringBill.payeeName || o.recurringBill.paymentMethod ? (
                            <p className="truncate text-sm text-muted-foreground">
                              {[o.recurringBill.payeeName ? `Para ${o.recurringBill.payeeName}` : null, o.recurringBill.paymentMethod ? PAYMENT_METHODS[o.recurringBill.paymentMethod] : null].filter(Boolean).join(' · ')}
                            </p>
                          ) : null}
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
                            {installmentLabel(o) ? <Badge variant="info">{installmentLabel(o)}</Badge> : null}
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

        </div>
      )}

      {paying ? <PaymentDialog occ={paying} tz={tz} onClose={() => setPaying(null)} /> : null}
      {newPayment ? <PaymentDialog occ={null} tz={tz} onClose={() => setNewPayment(false)} /> : null}
      {details ? (
        <BillDetailsDialog
          billId={details.billId}
          focus={details.focus}
          admin={admin}
          onClose={() => setDetails(null)}
          onPay={(o) => {
            setDetails(null);
            setPaying(o);
          }}
          onEdit={(b) => {
            setDetails(null);
            setBillForm(b);
          }}
        />
      ) : null}
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

/** "Parcela 3/10" quando a conta é parcelada. */
function installmentLabel(o: BillOccurrence): string | null {
  const rb = o.recurringBill;
  if (!rb.installments || !rb.startsOn) return null;
  const [sy, sm] = rb.startsOn.slice(0, 7).split('-').map(Number) as [number, number];
  const [cy, cm] = o.competence.split('-').map(Number) as [number, number];
  return `Parcela ${(cy - sy) * 12 + (cm - sm) + 1}/${rb.installments}`;
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

export function BillsList({
  bills,
  admin,
  onEdit,
  onOpen,
}: {
  bills: RecurringBill[];
  admin: boolean;
  onEdit: (b: RecurringBill) => void;
  onOpen: (b: RecurringBill) => void;
}) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<RecurringBill | null>(null);
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
            <button type="button" onClick={() => onOpen(b)} className="-my-3 block min-h-11 max-w-full truncate text-left font-medium leading-[2.75rem] underline-offset-4 hover:underline">
              {b.name}
            </button>
            <p className="text-sm text-muted-foreground">
              Dia {b.dueDay} · {billAmountLabel(b)}
              {b.lateFeeCents ? ` · multa ${formatBRL(b.lateFeeCents)}` : ''}
              {b.installments ? ` · ${b.installments} parcelas${b.endsOn ? `, até ${formatCompetence(b.endsOn.slice(0, 7))}` : ''}` : ''}
            </p>
            {b.payeeName || b.paymentMethod ? (
              <p className="truncate text-sm text-muted-foreground">{[b.payeeName ? `Para ${b.payeeName}` : null, b.paymentMethod ? PAYMENT_METHODS[b.paymentMethod] : null].filter(Boolean).join(' · ')}</p>
            ) : null}
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleting(b)}
                  aria-label={`Excluir ${b.name}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </>
            ) : null}
          </div>
        </li>
      ))}
      {deleting ? <DeleteBillDialog bill={deleting} onClose={() => setDeleting(null)} /> : null}
    </ul>
  );
}

/** Exclusão definitiva: diferente de suspender, apaga parcelas, pagamentos e comprovantes. */
function DeleteBillDialog({ bill: b, onClose }: { bill: RecurringBill; onClose: () => void }) {
  const qc = useQueryClient();
  const details = useQuery({ queryKey: ['bills', 'details', b.id], queryFn: () => api<BillDetails>(`/bills/${b.id}/details`) });
  const remove = useMutation({
    mutationFn: () => apiSend(`/bills/${b.id}`, 'DELETE'),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['bills', 'details', b.id] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success(`${b.name} excluída.`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const payments = details.data?.occurrences.reduce((n, o) => n + o.payments.length, 0) ?? 0;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Excluir ${b.name}?`}
      description="Não dá para desfazer. Para parar os avisos e guardar o histórico, use “Suspender”."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
            Excluir conta
          </Button>
        </>
      }
    >
      <div className="rounded-md bg-muted p-4 text-sm">
        <p className="font-medium">Saem junto com a conta:</p>
        <ul className="mt-1 list-inside list-disc text-muted-foreground">
          <li>as parcelas de todos os meses e os avisos que ainda iam sair</li>
          {payments ? (
            <li>
              {payments} pagamento{payments > 1 ? 's' : ''} registrado{payments > 1 ? 's' : ''} (
              <span className="tabular">{formatBRL(details.data?.paidCents ?? 0)}</span>) e os comprovantes: os totais
              pagos dos meses passados mudam
            </li>
          ) : null}
        </ul>
      </div>
    </Dialog>
  );
}

/** Em aberto para pagar agora: restante + multa (se atrasada); null = valor variável sem valor. */
function suggestedAmount(o: BillOccurrence): number | null {
  const fee = o.status === 'overdue' ? (o.recurringBill.lateFeeCents ?? 0) : 0;
  if (o.expectedAmountCents === null || (o.recurringBill.isVariableAmount && o.paidAmountCents === 0)) return null;
  return o.expectedAmountCents - o.paidAmountCents + fee;
}

/**
 * Registrar pagamento, com comprovante opcional (foto ou PDF). Sem `occ`, o modal começa pela
 * escolha da conta (contas em aberto: atrasadas e as que vencem nos próximos 60 dias).
 */
export function PaymentDialog({ occ: initial, tz, onClose }: { occ: BillOccurrence | null; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const choosing = initial === null;
  const open = useQuery({ queryKey: ['bills', 'upcoming', 60], queryFn: () => api<BillOccurrence[]>('/bills/upcoming?days=60'), enabled: choosing });
  const [occ, setOcc] = useState<BillOccurrence | null>(initial);
  const [amount, setAmount] = useState(() => {
    const s = initial ? suggestedAmount(initial) : null;
    return s === null ? '' : centsToInput(s);
  });
  const [paidOn, setPaidOn] = useState(todayIn(tz));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remaining = occ ? suggestedAmount(occ) : null;

  function pick(id: string) {
    const o = open.data?.find((x) => x.id === id) ?? null;
    setOcc(o);
    const s = o ? suggestedAmount(o) : null;
    setAmount(s === null ? '' : centsToInput(s));
    setError(null);
  }

  function chooseFile(f: File | null) {
    setError(null);
    if (f && !PROOF_TYPES.includes(f.type)) return setError('Envie o comprovante em foto (JPG, PNG, WebP) ou PDF.');
    if (f && f.size > MAX_PROOF_BYTES) return setError('O comprovante deve ter até 10 MB.');
    setFile(f);
  }

  const pay = useMutation({
    mutationFn: (cents: number) =>
      file
        ? payWithProof(occ!.id, file, { amountCents: cents, paidOn })
        : apiSend(`/bills/occurrences/${occ!.id}/payments`, 'POST', { amountCents: cents, paidOn }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success(file ? 'Pagamento registrado com o comprovante.' : 'Pagamento registrado.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!occ) return setError('Escolha a conta.');
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0) return setError('Informe um valor válido, ex.: 310,00');
    pay.mutate(cents);
  }

  const label = (o: BillOccurrence) => {
    const s = suggestedAmount(o);
    return `${o.recurringBill.name} · vence ${DateTime.fromISO(o.dueDate.slice(0, 10)).toFormat('dd/LL')}${s === null ? '' : ` · ${formatBRL(s)}`}${o.status === 'overdue' ? ' (atrasada)' : ''}`;
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={occ && !choosing ? `Registrar pagamento — ${occ.recurringBill.name}` : 'Adicionar pagamento'}
      description={
        occ ? `Competência ${formatCompetence(occ.competence)}${remaining !== null ? ` · em aberto ${formatBRL(remaining)}` : ''}` : 'Escolha a conta, anexe o comprovante e salve: a conta fica paga.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="payment-form" loading={pay.isPending}>
            {file ? 'Salvar com comprovante' : 'Marcar como paga'}
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="grid gap-4" noValidate>
        {choosing ? (
          <Field label="Conta">
            {(id) => (
              <Select id={id} value={occ?.id ?? ''} onChange={(e) => pick(e.target.value)} disabled={open.isPending}>
                <option value="">{open.isPending ? 'Carregando…' : (open.data?.length ?? 0) === 0 ? 'Nenhuma conta em aberto' : 'Escolha a conta'}</option>
                {(open.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {occ?.recurringBill.payeeName || occ?.recurringBill.paymentDetails || occ?.recurringBill.paymentMethod ? (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {occ.recurringBill.payeeName ? (
              <p>
                <span className="text-muted-foreground">Pagar para:</span> {occ.recurringBill.payeeName}
              </p>
            ) : null}
            {occ.recurringBill.paymentMethod ? (
              <p>
                <span className="text-muted-foreground">Meio:</span> {PAYMENT_METHODS[occ.recurringBill.paymentMethod]}
              </p>
            ) : null}
            {occ.recurringBill.paymentDetails ? (
              <p className="whitespace-pre-line break-words">
                <span className="text-muted-foreground">Como pagar:</span> {occ.recurringBill.paymentDetails}
              </p>
            ) : null}
          </div>
        ) : null}
        <Field label="Comprovante (foto ou PDF, opcional)" hint="O mesmo comprovante não vale para duas contas">
          {(id, describedBy) =>
            file ? (
              <div className="flex min-h-11 items-center justify-between gap-2 rounded-sm border bg-muted/40 px-3">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <Paperclip size={16} aria-hidden className="shrink-0" />
                  <span className="truncate">{file.name}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setFile(null)} aria-label="Tirar comprovante">
                  Trocar
                </Button>
              </div>
            ) : (
              <Input
                id={id}
                type="file"
                accept={PROOF_TYPES.join(',')}
                aria-describedby={describedBy}
                className="py-2 file:mr-3 file:rounded-sm file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
              />
            )
          }
        </Field>
        <Field label="Valor pago (R$)" hint="Valor menor que o previsto fica como pagamento parcial">
          {(id, describedBy) => (
            <Input id={id} inputMode="decimal" className="tabular" value={amount} aria-describedby={describedBy} onChange={(e) => setAmount(e.target.value)} />
          )}
        </Field>
        <Field label="Data do pagamento">{(id) => <Input id={id} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

export function BillDialog({ tz, bill, onClose }: { tz: string; bill: RecurringBill | null; onClose: () => void }) {
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
  const [payee, setPayee] = useState(bill?.payeeName ?? '');
  const [howToPay, setHowToPay] = useState(bill?.paymentDetails ?? '');
  const [method, setMethod] = useState<PaymentMethod | ''>(bill?.paymentMethod ?? '');
  const [installments, setInstallments] = useState(bill?.installments ? String(bill.installments) : '');
  const [firstMonth, setFirstMonth] = useState(bill?.startsOn ? bill.startsOn.slice(0, 7) : todayIn(tz).slice(0, 7));
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
      const parts = installments.trim() ? Number(installments) : null;
      if (parts !== null && (!Number.isInteger(parts) || parts < 1 || parts > 120)) return setError('Número de parcelas entre 1 e 120 (ou deixe vazio).');
      if (parts !== null && !/^\d{4}-\d{2}$/.test(firstMonth)) return setError('Informe o mês da primeira parcela.');
      return save.mutate({
        kind,
        name: name.trim(),
        expenseCategoryId: effectiveCategory || null,
        dueDay: day,
        estimatedAmountCents: cents,
        isVariableAmount: false,
        lateFeeCents: fee,
        payeeName: payee.trim() || null,
        paymentMethod: method || null,
        paymentDetails: howToPay.trim() || null,
        installments: parts,
        ...(bill ? {} : { startsOn: `${parts !== null ? firstMonth : todayIn(tz).slice(0, 7)}-01` }),
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
      payeeName: payee.trim() || null,
      paymentMethod: method || null,
      paymentDetails: howToPay.trim() || null,
      ...(bill ? {} : { startsOn: dueOn }),
    });
  }

  if (manage) return <ExpenseCategoriesDialog onClose={() => setManage(false)} />;

  return (
    <Dialog
      open
      size="wide"
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
      <form id="bill-form" onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0" noValidate>
        {/* Esquerda: o que é, quando vence e quanto custa. */}
        <div className="flex flex-col gap-4">
          <fieldset>
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

          <Field label="Nome">
            {(id) => (
              <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'monthly' ? 'Ex.: Aluguel, Internet' : 'Ex.: Compra de copos'} />
            )}
          </Field>
          <Field label="Categoria">
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
                <Button type="button" variant="outline" onClick={() => setManage(true)} aria-label="Gerenciar categorias">
                  <Tags aria-hidden />
                </Button>
              </div>
            )}
          </Field>

          {kind === 'monthly' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dia do vencimento">{(id) => <Input id={id} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />}</Field>
                <Field label="Valor (R$)">
                  {(id) => <Input id={id} inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />}
                </Field>
              </div>
              <Field label="Multa por atraso (R$, opcional)" hint="Somada ao valor quando a conta vence sem pagamento">
                {(id, describedBy) => (
                  <Input id={id} inputMode="decimal" className="tabular" value={lateFee} aria-describedby={describedBy} onChange={(e) => setLateFee(e.target.value)} placeholder="0,00" />
                )}
              </Field>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data">{(id) => <Input id={id} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}</Field>
                <Field label={variable ? 'Valor estimado (R$, opcional)' : 'Valor (R$)'}>
                  {(id) => <Input id={id} inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />}
                </Field>
              </div>
              <Checkbox label="Valor variável (informado no pagamento)" checked={variable} onChange={setVariable} />
            </>
          )}
        </div>

        {/* Direita: parcelas, para quem e como pagar. */}
        <div className="flex flex-col gap-4">
          {kind === 'monthly' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Parcelas (opcional)" hint="Vazio = todo mês, sem fim">
                {(id, describedBy) => (
                  <Input id={id} inputMode="numeric" className="tabular" value={installments} aria-describedby={describedBy} onChange={(e) => setInstallments(e.target.value)} placeholder="Ex.: 10" />
                )}
              </Field>
              {installments.trim() ? (
                <Field label="Primeira parcela" hint={bill ? 'Não muda na edição' : undefined}>
                  {(id, describedBy) => (
                    <Input id={id} type="month" value={firstMonth} disabled={!!bill} aria-describedby={describedBy} onChange={(e) => setFirstMonth(e.target.value)} />
                  )}
                </Field>
              ) : null}
            </div>
          ) : null}
          <Field label="Pagar para (opcional)">
            {(id) => <Input id={id} value={payee} maxLength={120} onChange={(e) => setPayee(e.target.value)} placeholder="Ex.: Imobiliária Lopes, Copel" />}
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Meio de pagamento</legend>
            <div role="radiogroup" aria-label="Meio de pagamento" className="grid grid-cols-2 gap-1 rounded-md border bg-card p-1 sm:grid-cols-4">
              {([['', 'Não definido'], ...Object.entries(PAYMENT_METHODS)] as Array<[PaymentMethod | '', string]>).map(([value, label]) => (
                <button
                  key={value || 'none'}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => setMethod(value)}
                  className={cn('min-h-11 rounded-sm px-2 text-sm font-medium text-muted-foreground', method === value && 'bg-primary text-primary-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field
            label={method === 'pix' ? 'Chave PIX e dados (opcional)' : method === 'boleto' ? 'Código de barras ou onde achar o boleto (opcional)' : method === 'credit_card' ? 'Qual cartão (opcional)' : 'Como pagar (opcional)'}
            hint="Vai junto no aviso do vencimento"
          >
            {(id, describedBy) => (
              <Textarea id={id} rows={3} value={howToPay} maxLength={500} aria-describedby={describedBy} onChange={(e) => setHowToPay(e.target.value)} placeholder="Ex.: PIX 12.345.678/0001-90" />
            )}
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive lg:col-span-2">
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
