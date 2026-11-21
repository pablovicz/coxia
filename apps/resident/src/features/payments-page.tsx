import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Card, MetricCard } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatBRL } from '@coxia/ui/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { api, brDate, type Payment } from '@/lib/api';

function PaymentRow({ p }: { p: Payment }) {
  return (
    <li className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{p.description}</p>
        <p className="text-sm text-muted-foreground">{p.status === 'received' ? `Pago em ${brDate(p.receivedOn ?? p.expectedOn)}` : `Vence em ${brDate(p.expectedOn)}`}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular font-semibold">{formatBRL(p.amountCents)}</span>
        {p.status === 'received' ? <Badge variant="active">Pago</Badge> : p.overdue ? <Badge variant="late">Atrasado</Badge> : <Badge variant="pending">Previsto</Badge>}
      </div>
    </li>
  );
}

export function PaymentsPage() {
  const q = useQuery({ queryKey: ['payments'], queryFn: () => api<Payment[]>('/me/payments') });
  const all = q.data ?? [];
  const future = all.filter((p) => p.status === 'expected').sort((a, b) => a.expectedOn.localeCompare(b.expectedOn));
  const paid = all.filter((p) => p.status === 'received');
  const overdue = future.filter((p) => p.overdue).reduce((s, p) => s + p.amountCents, 0);

  return (
    <>
      <PageHeader eyebrow="Pagamentos" title="Pagamentos" description="Mensalidades pagas e as próximas. Pagamentos são registrados pela equipe da Casa Kaju." />
      {q.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : all.length === 0 ? (
        <EmptyState icon={Wallet} title="Nenhum pagamento ainda">
          As mensalidades do seu contrato aparecem aqui.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3">
            <MetricCard title="Em aberto" value={formatBRL(future.reduce((s, p) => s + p.amountCents, 0))} caption={overdue ? `${formatBRL(overdue)} atrasado` : `${future.length} previsto(s)`} compact />
            <MetricCard title="Pago" value={formatBRL(paid.reduce((s, p) => s + p.amountCents, 0))} caption={`${paid.length} pagamento(s)`} compact />
          </div>
          {future.length ? (
            <section aria-labelledby="futuros" className="mb-6">
              <h2 id="futuros" className="mb-3 font-display text-xl font-semibold">
                Próximos
              </h2>
              <Card>
                <ul className="divide-y">
                  {future.map((p) => (
                    <PaymentRow key={p.id} p={p} />
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
          {paid.length ? (
            <section aria-labelledby="feitos">
              <h2 id="feitos" className="mb-3 font-display text-xl font-semibold">
                Feitos
              </h2>
              <Card>
                <ul className="divide-y">
                  {paid.map((p) => (
                    <PaymentRow key={p.id} p={p} />
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
