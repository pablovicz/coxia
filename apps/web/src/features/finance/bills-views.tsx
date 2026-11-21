import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, FileText, Paperclip, Pencil } from 'lucide-react';
import { DateTime } from 'luxon';
import { type ReactNode, useRef } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@coxia/ui/components/ui/card';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { monthGrid, WEEKDAY_HEADERS } from '@coxia/ui/calendar/calendar';
import { api, apiSend, type BillDetails, type BillOccurrence, type ExpenseCategory, fetchPaymentProof, MAX_PROOF_BYTES, PAYMENT_METHODS, payWithProof, PROOF_TYPES, type RecurringBill } from '@/lib/api';
import { CategoryIcon } from '@/lib/expense-categories';
import { formatBRL, formatCompetence, formatDayTitle, formatDueDate, formatShortDay, todayIn } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import { CategoryBadge } from './expense-categories';

/** Filtro de categoria: 'all', 'none' (sem categoria) ou o id da categoria. */
export type CategoryFilterValue = string;

export const matchesCategory = (o: { recurringBill: { expenseCategory?: { id: string } | null } }, filter: CategoryFilterValue) =>
  filter === 'all' || (filter === 'none' ? !o.recurringBill.expenseCategory : o.recurringBill.expenseCategory?.id === filter);

export function CategoryFilter({
  categories,
  value,
  onChange,
}: {
  categories: ExpenseCategory[];
  value: CategoryFilterValue;
  onChange: (v: CategoryFilterValue) => void;
}) {
  const chip = 'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-3 text-sm font-medium text-muted-foreground lg:min-h-9';
  return (
    <div role="radiogroup" aria-label="Filtrar por categoria" className="flex flex-wrap gap-1 rounded-md border bg-card p-1">
      <button type="button" role="radio" aria-checked={value === 'all'} onClick={() => onChange('all')} className={cn(chip, value === 'all' && 'bg-muted text-foreground')}>
        Todas
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          onClick={() => onChange(c.id)}
          style={roomStyle(c.color)}
          className={cn(chip, value === c.id && 'room-soft text-foreground')}
        >
          <CategoryIcon icon={c.icon} size={16} className="room-text" />
          {c.name}
        </button>
      ))}
      <button type="button" role="radio" aria-checked={value === 'none'} onClick={() => onChange('none')} className={cn(chip, value === 'none' && 'bg-muted text-foreground')}>
        Sem categoria
      </button>
    </div>
  );
}

const openOf = (o: BillOccurrence) => (o.expectedAmountCents === null ? null : Math.max(o.expectedAmountCents - o.paidAmountCents, 0));

/** "Hoje", "Amanhã", "Em 3 dias", "Atrasada há 2 dias". */
function dueIn(dueDate: string, today: string): { label: string; late: boolean } {
  const days = Math.round(DateTime.fromISO(dueDate.slice(0, 10)).diff(DateTime.fromISO(today), 'days').days);
  if (days < 0) return { label: `Atrasada há ${-days} dia${days === -1 ? '' : 's'}`, late: true };
  if (days === 0) return { label: 'Vence hoje', late: false };
  if (days === 1) return { label: 'Vence amanhã', late: false };
  return { label: `Em ${days} dias`, late: false };
}

/** As próximas contas (10 dias) e as atrasadas, sempre no topo do Financeiro. */
export function UpcomingBills({ tz, filter, onOpen }: { tz: string; filter: CategoryFilterValue; onOpen: (o: BillOccurrence) => void }) {
  const upcoming = useQuery({ queryKey: ['bills', 'upcoming'], queryFn: () => api<BillOccurrence[]>('/bills/upcoming?days=10') });
  const today = todayIn(tz);
  const items = (upcoming.data ?? []).filter((o) => matchesCategory(o, filter));
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Próximas contas</CardTitle>
        <CardDescription>Em aberto nos próximos 10 dias, com as atrasadas primeiro</CardDescription>
      </CardHeader>
      <CardContent>
        {upcoming.isPending ? (
          <Skeleton className="h-20" />
        ) : upcoming.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar as próximas contas.
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada vencendo nos próximos 10 dias. Tudo em dia.</p>
        ) : (
          <ul className="divide-y">
            {items.map((o) => {
              const when = dueIn(o.dueDate, today);
              const due = formatDueDate(o.dueDate);
              const open = openOf(o);
              return (
                <li key={o.id}>
                  <button type="button" onClick={() => onOpen(o)} className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left hover:bg-muted/40">
                    <span className="grid w-12 shrink-0 place-items-center rounded-md bg-muted py-1 text-center leading-tight">
                      <span className="text-[11px] uppercase text-muted-foreground">{due.month}</span>
                      <span className="tabular text-lg font-semibold">{due.day}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.recurringBill.name}</span>
                      <span className={cn('block text-sm', when.late ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                        {when.label}
                        {o.recurringBill.payeeName ? ` · para ${o.recurringBill.payeeName}` : ''}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-sm font-semibold">
                      {open === null ? 'a confirmar' : formatBRL(open + (o.status === 'overdue' ? (o.recurringBill.lateFeeCents ?? 0) : 0))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────── calendário (mês | semana) ─────────────

const competenceOfDate = (date: string) => date.slice(0, 7);

function useOccurrencesFor(competences: string[]) {
  const results = useQueries({
    queries: competences.map((c) => ({ queryKey: ['bills', 'occurrences', c], queryFn: () => api<BillOccurrence[]>(`/bills/occurrences?competence=${c}`) })),
  });
  return {
    pending: results.some((r) => r.isPending),
    error: results.some((r) => r.isError),
    data: results.flatMap((r) => r.data ?? []),
  };
}

function OccurrenceChip({ o, onOpen }: { o: BillOccurrence; onOpen: (o: BillOccurrence) => void }) {
  const open = openOf(o);
  return (
    <button
      type="button"
      onClick={() => onOpen(o)}
      style={roomStyle(o.recurringBill.expenseCategory?.color ?? 'grafite')}
      className={cn(
        'room-bar room-soft flex min-w-0 flex-col rounded-md px-2 py-1 text-left text-xs hover:brightness-95 dark:hover:brightness-110',
        o.status === 'paid' && 'opacity-60',
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        <CategoryIcon icon={o.recurringBill.expenseCategory?.icon ?? 'outros'} size={12} className="room-text shrink-0" />
        <span className={cn('truncate font-medium', o.status === 'paid' && 'line-through')}>{o.recurringBill.name}</span>
      </span>
      <span className={cn('tabular', o.status === 'overdue' ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
        {o.status === 'paid' ? 'Paga' : open === null ? 'a confirmar' : formatBRL(open)}
      </span>
    </button>
  );
}

/** Calendário das contas: mês (padrão) ou semana. A semana navega por conta própria. */
export function BillsCalendar({
  view,
  competence,
  week,
  onWeekChange,
  today,
  filter,
  onOpen,
}: {
  view: 'mes' | 'semana';
  competence: string;
  week: string;
  onWeekChange: (start: string) => void;
  today: string;
  filter: CategoryFilterValue;
  onOpen: (o: BillOccurrence) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => DateTime.fromISO(week).plus({ days: i }).toISODate()!);
  const competences = view === 'mes' ? [competence] : [...new Set(days.map(competenceOfDate))];
  const occ = useOccurrencesFor(competences);
  const byDay = new Map<string, BillOccurrence[]>();
  for (const o of occ.data.filter((x) => x.status !== 'cancelled' && matchesCategory(x, filter))) {
    const d = o.dueDate.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), o]);
  }
  const dayOf = (d: string) => byDay.get(d) ?? [];

  if (occ.pending) return <Skeleton className="h-64" />;
  if (occ.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar as contas.
      </p>
    );

  if (view === 'semana') {
    const last = DateTime.fromISO(days[6]!);
    return (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => onWeekChange(DateTime.fromISO(week).minus({ days: 7 }).toISODate()!)}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon" aria-label="Próxima semana" onClick={() => onWeekChange(DateTime.fromISO(week).plus({ days: 7 }).toISODate()!)}>
            <ChevronRight aria-hidden />
          </Button>
          <h3 className="ml-1 font-semibold" aria-live="polite">
            Semana de {DateTime.fromISO(week).toFormat('dd/LL')} a {last.toFormat('dd/LL')}
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-7">
          {days.map((d) => (
            <section key={d} aria-label={formatDayTitle(d)} className="min-w-0 rounded-lg border bg-card p-2 lg:min-h-48">
              <h4 className={cn('mb-2 px-1 text-sm font-semibold capitalize', d === today && 'text-primary')}>{formatShortDay(d)}</h4>
              <div className="flex flex-col gap-1.5">
                {dayOf(d).length === 0 ? <p className="px-1 text-xs text-muted-foreground lg:hidden">Nada vence</p> : null}
                {dayOf(d).map((o) => (
                  <OccurrenceChip key={o.id} o={o} onOpen={onOpen} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b text-center text-xs font-semibold text-muted-foreground" aria-hidden>
        {WEEKDAY_HEADERS.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(`${competence}-01`).map(({ date, inMonth }) => {
          const items = inMonth ? dayOf(date) : [];
          return (
            <div
              key={date}
              aria-label={inMonth ? `${DateTime.fromISO(date).setLocale('pt-BR').toFormat("d 'de' LLLL")}: ${items.length ? `${items.length} conta${items.length > 1 ? 's' : ''}` : 'nada vence'}` : undefined}
              className={cn('flex min-h-16 min-w-0 flex-col gap-1 border-b border-r p-1 [&:nth-child(7n)]:border-r-0 lg:min-h-28 lg:p-1.5', !inMonth && 'bg-muted/40')}
            >
              <span className={cn('tabular grid size-6 place-items-center self-start rounded-full text-xs font-semibold', date === today && 'bg-primary text-primary-foreground')}>
                {inMonth ? DateTime.fromISO(date).day : ''}
              </span>
              {/* Celular: um ponto por conta (na cor da categoria) que abre o detalhe. */}
              <span className="flex flex-wrap gap-1 lg:hidden">
                {items.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-label={`${o.recurringBill.name}: ver detalhes`}
                    onClick={() => onOpen(o)}
                    style={roomStyle(o.recurringBill.expenseCategory?.color ?? 'grafite')}
                    className="grid size-6 place-items-center rounded-full"
                  >
                    <span className={cn('room-fill size-2.5 rounded-full', o.status === 'overdue' && 'ring-2 ring-destructive')} />
                  </button>
                ))}
              </span>
              <span className="hidden flex-col gap-1 lg:flex">
                {items.map((o) => (
                  <OccurrenceChip key={o.id} o={o} onOpen={onOpen} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── detalhe da conta ─────────────

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'late' }) {
  return (
    <div className={cn('rounded-md border bg-card px-3 py-2', tone === 'late' && 'border-destructive/40')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('tabular text-lg font-semibold', tone === 'late' && 'text-destructive')}>{value}</p>
    </div>
  );
}

const OCC_STATUS: Record<BillOccurrence['status'], { label: string; variant: 'active' | 'pending' | 'late' | 'archived' | 'neutral' }> = {
  paid: { label: 'Paga', variant: 'active' },
  partially_paid: { label: 'Parcial', variant: 'pending' },
  pending: { label: 'A vencer', variant: 'neutral' },
  overdue: { label: 'Atrasada', variant: 'late' },
  cancelled: { label: 'Cancelada', variant: 'archived' },
};

const CHANNEL: Record<string, string> = { web: 'pelo painel', whatsapp: 'pelo WhatsApp', system: 'automaticamente' };

/**
 * Detalhe da conta: resumo (pago, saldo devedor, parcelas, atrasadas), atrasadas por mês,
 * configuração, cadastro e histórico. Pagar e editar ficam a um clique.
 */
export function BillDetailsDialog({
  billId,
  focus,
  admin,
  onClose,
  onPay,
  onEdit,
}: {
  billId: string;
  /** Ocorrência clicada (a que o botão Pagar quita); sem ela, a mais antiga em aberto. */
  focus: BillOccurrence | null;
  admin: boolean;
  onClose: () => void;
  onPay: (o: BillOccurrence) => void;
  onEdit: (b: RecurringBill) => void;
}) {
  const details = useQuery({ queryKey: ['bills', 'details', billId], queryFn: () => api<BillDetails>(`/bills/${billId}/details`) });
  const d = details.data;
  const b = d?.bill;

  // Ocorrência a pagar: a clicada (se em aberto) ou a mais antiga em aberto.
  const openOcc = d?.occurrences.filter((o) => o.status === 'pending' || o.status === 'partially_paid' || o.status === 'overdue') ?? [];
  const target = focus && focus.status !== 'paid' && focus.status !== 'cancelled' ? focus.id : openOcc[0]?.id;
  // Marcar como paga sem comprovante: quita o restante (com multa, se atrasada) com a data de hoje.
  // Valor variável ainda sem valor: abre o pagamento para informar quanto foi pago.
  const qc = useQueryClient();
  const targetOcc = d?.occurrences.find((x) => x.id === target);
  const amountKnown = !!targetOcc && !!b && targetOcc.expectedAmountCents !== null && !(b.isVariableAmount && targetOcc.paidAmountCents === 0);
  const markPaid = useMutation({
    mutationFn: (id: string) => apiSend(`/bills/occurrences/${id}/payments`, 'POST', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Conta marcada como paga.');
    },
    onError: (e) => toast.error(e.message),
  });
  const payTarget = () => {
    const o = d?.occurrences.find((x) => x.id === target);
    if (!o || !b) return;
    onPay({
      id: o.id,
      competence: o.competence,
      dueDate: o.dueDate,
      expectedAmountCents: o.expectedAmountCents,
      paidAmountCents: o.paidAmountCents,
      status: o.status,
      paidAt: o.paidAt,
      recurringBill: {
        id: b.id,
        name: b.name,
        kind: b.kind,
        category: b.category,
        isVariableAmount: b.isVariableAmount,
        lateFeeCents: b.lateFeeCents,
        installments: b.installments,
        startsOn: b.startsOn,
        payeeName: b.payeeName,
        paymentDetails: b.paymentDetails,
        paymentMethod: b.paymentMethod,
        expenseCategory: b.expenseCategory,
      },
      payments: [],
    });
  };

  const money = (c: number | null) => (c === null ? 'a confirmar' : formatBRL(c));
  return (
    <Dialog
      open
      size="wide"
      onOpenChange={(v) => !v && onClose()}
      title={b?.name ?? 'Conta'}
      description={b ? (b.kind === 'one_time' ? 'Lançamento pontual' : 'Conta mensal') : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {admin && b ? (
            <Button variant="outline" onClick={() => onEdit(b)}>
              <Pencil aria-hidden /> Editar
            </Button>
          ) : null}
          {admin && target ? (
            <>
              <Button variant="outline" loading={markPaid.isPending} onClick={() => (amountKnown ? markPaid.mutate(target) : payTarget())}>
                <Check aria-hidden /> Marcar como paga
              </Button>
              <Button onClick={payTarget}>
                <Paperclip aria-hidden /> Adicionar comprovante
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {details.isPending ? (
        <Skeleton className="h-64" />
      ) : details.isError || !d || !b ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar a conta.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-1.5">
              <CategoryBadge category={b.expenseCategory} />
              {!b.active ? <Badge variant="archived">Suspensa</Badge> : null}
            </div>
            <section aria-label="Resumo" className="grid grid-cols-2 gap-2">
              <Stat label="Total pago" value={formatBRL(d.paidCents)} />
              <Stat label="Saldo devedor" value={money(d.outstandingCents)} />
              {d.installments ? <Stat label="Parcelas restantes" value={`${d.installments.remaining} de ${d.installments.total}`} /> : null}
              {d.overdue.length ? <Stat label="Em atraso" value={money(d.overdueCents)} tone="late" /> : null}
            </section>

            {d.overdue.length ? (
              <section aria-labelledby="overdue-title">
                <h3 id="overdue-title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <AlertTriangle size={16} aria-hidden /> {d.overdue.length === 1 ? 'Parcela atrasada' : `${d.overdue.length} parcelas atrasadas`}
                </h3>
                <ul className="divide-y rounded-md border">
                  {d.overdue.map((o) => (
                    <li key={o.occurrenceId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="first-letter:uppercase">
                        {formatCompetence(o.competence)}
                        {o.installment ? ` · parcela ${o.installment.number}/${o.installment.total}` : ''}
                      </span>
                      <span className="tabular font-medium">
                        {money(o.openCents)}
                        {o.lateFeeCents ? ` + multa ${formatBRL(o.lateFeeCents)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="config-title">
              <h3 id="config-title" className="mb-1 text-sm font-semibold">
                Configuração
              </h3>
              <dl className="divide-y">
                <Row label="Vencimento">{b.kind === 'one_time' ? (b.startsOn ? formatDayTitle(b.startsOn.slice(0, 10)) : '—') : `Todo dia ${b.dueDay}`}</Row>
                <Row label="Valor">{b.estimatedAmountCents === null ? 'Variável' : `${formatBRL(b.estimatedAmountCents)}${b.isVariableAmount ? ' (estimado)' : ''}`}</Row>
                {b.lateFeeCents ? <Row label="Multa por atraso">{formatBRL(b.lateFeeCents)}</Row> : null}
                {b.installments ? (
                  <Row label="Parcelas">
                    {b.installments}
                    {b.startsOn && b.endsOn ? `, de ${formatCompetence(b.startsOn.slice(0, 7))} a ${formatCompetence(b.endsOn.slice(0, 7))}` : ''}
                  </Row>
                ) : b.kind !== 'one_time' ? (
                  <Row label="Parcelas">Sem fim (todo mês)</Row>
                ) : null}
                <Row label="Pagar para">{b.payeeName ?? '—'}</Row>
                <Row label="Meio de pagamento">{b.paymentMethod ? PAYMENT_METHODS[b.paymentMethod] : 'Não definido'}</Row>
                {b.paymentDetails ? (
                  <Row label="Como pagar">
                    <span className="whitespace-pre-line">{b.paymentDetails}</span>
                  </Row>
                ) : null}
                <Row label="Avisos">Véspera e dia do vencimento; reaviso a cada {b.overdueReminderEveryDays ?? 3} dias se atrasar</Row>
              </dl>
            </section>

            <section aria-labelledby="created-title">
              <h3 id="created-title" className="mb-1 text-sm font-semibold">
                Cadastro
              </h3>
              <dl className="divide-y">
                <Row label="Cadastrada por">{d.createdBy?.name ? `${d.createdBy.name} ${CHANNEL[d.createdBy.channel] ?? ''}`.trim() : 'Não registrado'}</Row>
                <Row label="Data do cadastro">{DateTime.fromISO(d.createdAt).setLocale('pt-BR').toFormat("dd/LL/yyyy 'às' HH:mm")}</Row>
              </dl>
            </section>
          </div>

          <section aria-labelledby="history-title">
            <h3 id="history-title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <CalendarClock size={16} aria-hidden /> Histórico
            </h3>
            {d.occurrences.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nenhum vencimento ainda">
                Os vencimentos são gerados para o mês atual e o próximo.
              </EmptyState>
            ) : (
              <ul className="divide-y rounded-md border">
                {[...d.occurrences].reverse().map((o) => {
                  const st = OCC_STATUS[o.status];
                  return (
                    <li key={o.id} className={cn('flex items-center gap-3 px-3 py-2 text-sm', o.id === focus?.id && 'bg-primary/5')}>
                      <span className="min-w-0 flex-1">
                        <span className="block first-letter:uppercase">
                          {formatCompetence(o.competence)}
                          {o.installment ? ` · ${o.installment.number}/${o.installment.total}` : ''}
                        </span>
                        <span className="tabular block text-muted-foreground">
                          {o.paidAmountCents > 0 ? `${formatBRL(o.paidAmountCents)} pagos` : `vence ${DateTime.fromISO(o.dueDate).toFormat('dd/LL')}`}
                          {o.expectedAmountCents !== null && o.paidAmountCents < o.expectedAmountCents && o.paidAmountCents > 0 ? ` de ${formatBRL(o.expectedAmountCents)}` : ''}
                          {o.proofs ? ` · ${o.proofs} comprovante${o.proofs > 1 ? 's' : ''}` : ''}
                        </span>
                      </span>
                      {o.payments.filter((p) => p.hasProof).map((p) => (
                        <ViewProofButton key={p.id} paymentId={p.id} />
                      ))}
                      {admin && o.status === 'paid' && !o.payments.some((p) => p.hasProof) ? <AttachProofButton occurrenceId={o.id} billId={b.id} /> : null}
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** Abre o comprovante numa aba nova (o arquivo passa pela api: bucket privado). */
function ViewProofButton({ paymentId }: { paymentId: string }) {
  async function open() {
    // Abre a aba já no clique (senão o navegador bloqueia como pop-up) e carrega o arquivo nela.
    const tab = window.open('', '_blank');
    try {
      const blob = await fetchPaymentProof(paymentId);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      toast.error('Não foi possível abrir o comprovante.');
    }
  }
  return (
    <Button type="button" variant="ghost" size="sm" onClick={open} aria-label="Ver comprovante">
      <FileText aria-hidden /> <span className="hidden sm:inline">Comprovante</span>
    </Button>
  );
}

/** Conta paga sem comprovante: anexa o arquivo (foto ou PDF). */
function AttachProofButton({ occurrenceId, billId }: { occurrenceId: string; billId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const attach = useMutation({
    mutationFn: (file: File) => payWithProof(occurrenceId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills', 'details', billId] });
      toast.success('Comprovante anexado.');
    },
    onError: (e) => toast.error(e.message),
  });
  function choose(file: File | undefined) {
    if (!file) return;
    if (!PROOF_TYPES.includes(file.type)) return toast.error('Envie o comprovante em foto (JPG, PNG, WebP) ou PDF.');
    if (file.size > MAX_PROOF_BYTES) return toast.error('O comprovante deve ter até 10 MB.');
    attach.mutate(file);
  }
  return (
    <>
      <input ref={input} type="file" accept={PROOF_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => choose(e.target.files?.[0])} />
      <Button type="button" variant="ghost" size="sm" loading={attach.isPending} onClick={() => input.current?.click()}>
        <Paperclip aria-hidden /> <span className="hidden sm:inline">Anexar comprovante</span>
        <span className="sr-only sm:hidden">Anexar comprovante</span>
      </Button>
    </>
  );
}
