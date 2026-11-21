import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatBRL, formatCompetence } from '@coxia/ui/lib/format';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, FileText } from 'lucide-react';
import { Link } from 'react-router';
import { CycleCard } from '@/components/balance';
import { OccurrenceCard } from '@/components/occurrence-card';
import { api, brDate, brDayMonth, hours, type Occurrence, type Payment } from '@/lib/api';
import { useAuth } from '@/providers/auth';

export function HomePage() {
  const { me } = useAuth();
  const now = new Date();
  const until = new Date(now.getTime() + 45 * 86400_000);
  const upcoming = useQuery({
    queryKey: ['bookings', 'upcoming'],
    queryFn: () => api<Occurrence[]>(`/me/bookings?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(until.toISOString())}`),
  });
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => api<Payment[]>('/me/payments') });
  if (!me) return null;
  const contracts = me.contracts.filter((c) => c.status === 'active');
  const open = (payments.data ?? []).filter((p) => p.status === 'expected').sort((a, b) => a.expectedOn.localeCompare(b.expectedOn));
  const firstName = me.resident.name.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={me.organization.name}
        title={`Olá, ${firstName}`}
        description="Seu saldo de horas, próximas reservas e pagamentos."
        action={
          contracts.length ? (
            <Button asChild>
              <Link to="/reservar">
                <CalendarPlus /> Reservar sala
              </Link>
            </Button>
          ) : null
        }
      />

      {contracts.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhum contrato ativo">
          Quando a equipe da Casa Kaju cadastrar o seu contrato de horas, o saldo e as reservas aparecem aqui.
        </EmptyState>
      ) : (
        <section aria-labelledby="saldo" className="flex flex-col gap-4">
          <h2 id="saldo" className="sr-only">
            Saldo de horas
          </h2>
          {contracts.map((c) =>
            c.balance ? (
              <CycleCard key={c.id} space={c.space} b={c.balance.current} label={`${hours(c.monthlyMinutes)} por mês · ciclo de ${formatCompetence(c.balance.current.cycle)}`}>
                {c.balance.next ? (
                  <p className="mt-4 rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                    A agenda de {formatCompetence(c.balance.next.cycle)} já abriu: <strong className="tabular">{hours(c.balance.next.availableMinutes)}</strong> para reservar a partir de {brDayMonth(c.balance.next.startsOn)}.
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/reservar?contrato=${c.id}`}>Reservar</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/contratos/${c.id}`}>Contrato e extrato</Link>
                  </Button>
                </div>
              </CycleCard>
            ) : null,
          )}
          <p className="text-xs text-muted-foreground">As horas não acumulam: o que sobrar no ciclo expira no dia da renovação.</p>
        </section>
      )}

      <section aria-labelledby="proximas" className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="proximas" className="font-display text-xl font-semibold">
            Próximas reservas
          </h2>
          <Link to="/reservas" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Ver todas
          </Link>
        </div>
        {upcoming.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (upcoming.data ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma reserva nos próximos dias.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(upcoming.data ?? []).slice(0, 4).map((o) => (
              <OccurrenceCard key={o.id} o={o} />
            ))}
          </ul>
        )}
      </section>

      {open.length ? (
        <section aria-labelledby="pagamentos" className="mt-8">
          <h2 id="pagamentos" className="mb-3 font-display text-xl font-semibold">
            Pagamentos em aberto
          </h2>
          <Card className="divide-y">
            {open.slice(0, 3).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{p.description}</p>
                  <p className={p.overdue ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{p.overdue ? `Venceu em ${brDate(p.expectedOn)}` : `Vence em ${brDate(p.expectedOn)}`}</p>
                </div>
                <p className="tabular font-semibold">{formatBRL(p.amountCents)}</p>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </>
  );
}
