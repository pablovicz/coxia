import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Card } from '@coxia/ui/components/ui/card';
import { formatBRL, formatCompetence } from '@coxia/ui/lib/format';
import { roomStyle } from '@coxia/ui/lib/rooms';
import { ChevronRight, FileText } from 'lucide-react';
import { Link } from 'react-router';
import { RoomTitle } from '@/components/balance';
import { brDate, hours } from '@/lib/api';
import { useAuth } from '@/providers/auth';

/** Os contratos do residente: sala, horas, mensalidade, vigência e o saldo do ciclo. */
export function ContractsPage() {
  const { me } = useAuth();
  const contracts = me?.contracts ?? [];
  return (
    <>
      <PageHeader eyebrow="Contratos" title="Meus contratos" description="Sala, horas por ciclo, mensalidade e vigência. Toque num contrato para ver o extrato de horas." />
      {contracts.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhum contrato">
          Quando a equipe da Casa Kaju cadastrar o seu contrato de horas, ele aparece aqui.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {contracts.map((c) => (
            <li key={c.id}>
              <Card className="h-full" style={roomStyle(c.space.color)}>
                <Link to={`/contratos/${c.id}`} className="flex h-full flex-col gap-4 rounded-lg p-5 hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-3">
                    <RoomTitle space={c.space} subtitle={c.endsOn ? `${brDate(c.startsOn)} a ${brDate(c.endsOn)}` : `Desde ${brDate(c.startsOn)}`} />
                    <Badge variant={c.status === 'active' ? 'active' : 'archived'}>{c.status === 'active' ? 'Vigente' : 'Encerrado'}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Horas por ciclo</dt>
                      <dd className="tabular font-medium">{hours(c.monthlyMinutes)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Mensalidade</dt>
                      <dd className="tabular font-medium">{c.monthlyAmountCents ? formatBRL(c.monthlyAmountCents) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Renova o saldo</dt>
                      <dd className="font-medium">todo dia {c.cycleDay}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Agenda do próximo ciclo</dt>
                      <dd className="font-medium">abre dia {c.bookingOpensDay}</dd>
                    </div>
                  </dl>
                  {c.status === 'active' && c.balance ? (
                    <p className="mt-auto flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                      <span>
                        <strong className="tabular">{hours(c.balance.current.availableMinutes)}</strong> disponíveis em {formatCompetence(c.balance.current.cycle)}
                      </span>
                      <ChevronRight size={16} aria-hidden />
                    </p>
                  ) : null}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
