import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, ChevronRight, Paperclip, Plus, Tags } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/input';
import { BillDialog, BillsList, PaymentDialog } from '@/features/reminders/bills-page';
import { api, type BillOccurrence, canManage, type FinanceMonth, type FinanceOverview, type RecurringBill } from '@/lib/api';
import { formatBRL, formatCompetence, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { BillDetailsDialog, UpcomingBills } from './bills-views';
import { ExpenseCategoriesDialog } from './expense-categories';

const monthName = (competence: string) => DateTime.fromISO(`${competence}-01`).setLocale('pt-BR').toFormat('LLLL');
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Financeiro: visão unificada do ano, com o mês atual em destaque e as próximas contas no topo.
 * Cada mês tem a própria página (/contas/AAAA-MM), com contas, entradas e calendário.
 */
export function FinanceOverviewPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const admin = canManage(session?.user.role);
  const current = todayIn(tz).slice(0, 7);
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('ano')) || Number(current.slice(0, 4));
  const setYear = (y: number) => setParams(y === Number(current.slice(0, 4)) ? {} : { ano: String(y) }, { replace: true });
  const [details, setDetails] = useState<{ billId: string; focus: BillOccurrence | null } | null>(null);
  const [paying, setPaying] = useState<BillOccurrence | null>(null);
  const [newPayment, setNewPayment] = useState(false);
  // null = fechado; 'new' = cadastro; RecurringBill = edição.
  const [editing, setEditing] = useState<RecurringBill | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const bills = useQuery({ queryKey: ['bills', 'list'], queryFn: () => api<RecurringBill[]>('/bills') });

  const overview = useQuery({ queryKey: ['finance', 'overview', year], queryFn: () => api<FinanceOverview>(`/finance/overview?year=${year}`) });
  // O destaque é sempre o mês atual (mesmo navegando por outros anos).
  const currentYear = useQuery({
    queryKey: ['finance', 'overview', Number(current.slice(0, 4))],
    queryFn: () => api<FinanceOverview>(`/finance/overview?year=${current.slice(0, 4)}`),
  });
  const now = currentYear.data?.months.find((m) => m.competence === current) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Dinheiro da casa"
        title="Financeiro."
        description="O ano num lugar só. Abra um mês para ver e lançar contas e entradas."
        action={
          <div className="flex flex-wrap gap-2">
            {admin ? (
              <>
                <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
                  <Tags aria-hidden /> Categorias
                </Button>
                <Button variant="outline" onClick={() => setEditing('new')}>
                  <Plus aria-hidden /> Nova conta
                </Button>
                <Button variant="outline" onClick={() => setNewPayment(true)}>
                  <Paperclip aria-hidden /> Adicionar pagamento
                </Button>
              </>
            ) : null}
            <Button asChild>
              <Link to={`/contas/${current}`}>
                Abrir {monthName(current)} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />

      <UpcomingBills tz={tz} filter="all" onOpen={(o) => setDetails({ billId: o.recurringBill.id, focus: o })} />

      <CurrentMonth competence={current} month={now} loading={currentYear.isPending} />

      <section aria-labelledby="year-title" className="mt-8">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Ano anterior" onClick={() => setYear(year - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon" aria-label="Próximo ano" onClick={() => setYear(year + 1)}>
            <ChevronRight aria-hidden />
          </Button>
          <h2 id="year-title" className="ml-1 text-lg font-semibold" aria-live="polite">
            {year}
          </h2>
          {overview.data ? (
            <p className="tabular ml-auto hidden text-sm text-muted-foreground sm:block">
              Entradas {formatBRL(overview.data.totals.incomeExpectedCents)} · Saídas {formatBRL(overview.data.totals.billsExpectedCents)} · Saldo{' '}
              {formatBRL(overview.data.totals.incomeExpectedCents - overview.data.totals.billsExpectedCents)}
            </p>
          ) : null}
        </div>
        {overview.isPending ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : overview.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar o ano.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {overview.data.months.map((m) => (
              <li key={m.competence}>
                <MonthCard month={m} current={m.competence === current} future={m.competence > current} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          As contas mensais aparecem a partir do mês atual e do próximo; nos meses mais à frente entram só lançamentos pontuais, parcelas já geradas e entradas.
        </p>
      </section>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Contas mensais cadastradas</CardTitle>
          <CardDescription>Vencimentos em dias 29–31 caem no último dia dos meses curtos</CardDescription>
        </CardHeader>
        <CardContent>
          {bills.isPending ? (
            <Skeleton className="h-32" />
          ) : bills.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar as contas.
            </p>
          ) : (
            <BillsList
              bills={bills.data.filter((b) => b.kind !== 'one_time')}
              admin={admin}
              onEdit={(b) => setEditing(b)}
              onOpen={(b) => setDetails({ billId: b.id, focus: null })}
            />
          )}
        </CardContent>
      </Card>

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
            setEditing(b);
          }}
        />
      ) : null}
      {paying ? <PaymentDialog occ={paying} tz={tz} onClose={() => setPaying(null)} /> : null}
      {newPayment ? <PaymentDialog occ={null} tz={tz} onClose={() => setNewPayment(false)} /> : null}
      {editing ? <BillDialog tz={tz} bill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {categoriesOpen ? <ExpenseCategoriesDialog onClose={() => setCategoriesOpen(false)} /> : null}
    </>
  );
}

function CurrentMonth({ competence, month, loading }: { competence: string; month: FinanceMonth | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-44" />;
  const m = month;
  const balance = m ? m.incomeExpectedCents - m.billsExpectedCents : 0;
  const overdue = m ? m.billsOverdue + m.incomesOverdue : 0;
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{capitalize(formatCompetence(competence))}</CardTitle>
          <CardDescription>Mês atual</CardDescription>
        </div>
        <Button variant="outline" asChild>
          <Link to={`/contas/${competence}`}>
            Ver contas e entradas <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Entradas" value={formatBRL(m?.incomeExpectedCents ?? 0)} caption={`${formatBRL(m?.incomeReceivedCents ?? 0)} recebidos`} />
          <Metric
            label="Saídas"
            value={formatBRL(m?.billsExpectedCents ?? 0)}
            caption={`${formatBRL(m?.billsPaidCents ?? 0)} pagos${m?.variableWithoutAmount ? ` · + ${m.variableWithoutAmount} variável` : ''}`}
          />
          <Metric label="Saldo previsto" value={formatBRL(balance)} caption="Entradas menos saídas" tone={balance < 0 ? 'late' : undefined} />
          <Metric label="Atrasadas" value={String(overdue)} caption={overdue ? `${m?.billsOverdue ?? 0} conta(s) · ${m?.incomesOverdue ?? 0} entrada(s)` : 'Tudo em dia'} tone={overdue ? 'late' : undefined} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, caption, tone }: { label: string; value: string; caption: string; tone?: 'late' }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular truncate text-lg font-semibold sm:text-xl', tone === 'late' && 'text-destructive')}>{value}</dd>
      <dd className="truncate text-xs text-muted-foreground">{caption}</dd>
    </div>
  );
}

function MonthCard({ month: m, current, future }: { month: FinanceMonth; current: boolean; future: boolean }) {
  const balance = m.incomeExpectedCents - m.billsExpectedCents;
  const empty = m.incomeExpectedCents === 0 && m.billsExpectedCents === 0 && m.variableWithoutAmount === 0;
  const paidPct = m.billsExpectedCents ? Math.min(100, Math.round((m.billsPaidCents / m.billsExpectedCents) * 100)) : 0;
  const overdue = m.billsOverdue + m.incomesOverdue;
  return (
    <Link
      to={`/contas/${m.competence}`}
      aria-label={`${capitalize(monthName(m.competence))}${current ? ' (mês atual)' : ''}: saídas ${formatBRL(m.billsExpectedCents)}, entradas ${formatBRL(m.incomeExpectedCents)}`}
      className={cn(
        'flex h-full flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50',
        current && 'border-primary ring-2 ring-primary/40',
        future && empty && 'opacity-70',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold capitalize">{monthName(m.competence)}</span>
        {current ? <Badge variant="info">Atual</Badge> : overdue ? <Badge variant="late">{overdue} atrasada{overdue > 1 ? 's' : ''}</Badge> : null}
      </span>
      {empty ? (
        <span className="text-sm text-muted-foreground">Nada lançado</span>
      ) : (
        <>
          <span className="tabular grid grid-cols-2 gap-x-3 text-sm">
            <span className="text-muted-foreground">Saídas</span>
            <span className="text-right">{formatBRL(m.billsExpectedCents)}</span>
            <span className="text-muted-foreground">Entradas</span>
            <span className="text-right">{formatBRL(m.incomeExpectedCents)}</span>
            <span className="text-muted-foreground">Saldo</span>
            <span className={cn('text-right font-semibold', balance < 0 && 'text-destructive')}>{formatBRL(balance)}</span>
          </span>
          {m.billsExpectedCents ? (
            <span className="mt-auto">
              <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${paidPct}%` }} />
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{paidPct}% das contas pagas</span>
            </span>
          ) : null}
        </>
      )}
    </Link>
  );
}
