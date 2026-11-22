import { PageHeader } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { formatBRL, formatCompetence, local } from '@coxia/ui/lib/format';
import { useQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { CycleCard } from '@/components/balance';
import { api, apiBlob, brDate, type ContractDetail, hours, type LedgerEntry } from '@/lib/api';
import { useCheckInEnabled, useTimezone } from '@/providers/auth';

function ledgerLabel(e: LedgerEntry, checkIn: boolean) {
  if (e.kind === 'monthly') return 'Horas do ciclo';
  if (e.kind === 'adjustment') return e.note ? `Ajuste da equipe — ${e.note}` : 'Ajuste da equipe';
  if (!checkIn) return e.attendance === 'checked_in' || e.attendance === 'no_show' ? 'Reserva realizada' : 'Reserva';
  const a = { upcoming: 'Reserva', in_progress: 'Reserva (agora)', checked_in: 'Reserva · check-in feito', no_show: 'Reserva · sem check-in' } as const;
  return a[e.attendance ?? 'upcoming'];
}

export function ContractPage() {
  const checkIn = useCheckInEnabled();
  const { id } = useParams();
  const tz = useTimezone();
  const [opening, setOpening] = useState(false);
  const q = useQuery({ queryKey: ['contract', id], queryFn: () => api<ContractDetail>(`/me/contracts/${id}`) });
  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (!q.data) return <p className="text-muted-foreground">Contrato não encontrado.</p>;
  const { contract: c, cycles } = q.data;

  async function openFile() {
    setOpening(true);
    try {
      const blob = await apiBlob(`/me/contracts/${c.id}/file`);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch {
      toast.error('Não foi possível abrir o arquivo.');
    } finally {
      setOpening(false);
    }
  }

  const terms: Array<[string, string]> = [
    ['Horas por ciclo', hours(c.monthlyMinutes)],
    ['Renovação do saldo', `todo dia ${c.cycleDay}`],
    ['Agenda do próximo ciclo abre', `todo dia ${c.bookingOpensDay}`],
    ['Mensalidade', c.monthlyAmountCents ? `${formatBRL(c.monthlyAmountCents)}${c.paymentDueDay ? `, vence dia ${c.paymentDueDay}` : ''}` : '—'],
    ['Vigência', c.endsOn ? `${brDate(c.startsOn)} a ${brDate(c.endsOn)}` : `desde ${brDate(c.startsOn)}`],
  ];

  return (
    <>
      <PageHeader
        eyebrow="Contrato"
        title={c.space.name}
        description="Termos, saldo e extrato de horas."
        action={
          c.hasFile ? (
            <Button variant="outline" loading={opening} onClick={openFile}>
              <FileDown /> Ver contrato
            </Button>
          ) : null
        }
      />
      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Termos</h2>
          <Badge variant={c.status === 'active' ? 'active' : 'archived'}>{c.status === 'active' ? 'Vigente' : 'Encerrado'}</Badge>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          {terms.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          As horas não acumulam de um ciclo para o outro. Reservar já usa as horas; cancelar antes do início devolve.{' '}
          {checkIn ? 'Faltas e check-in atrasado contam a reserva inteira.' : 'Sem cancelamento, as horas são debitadas no horário da reserva.'}
        </p>
      </Card>

      <div className="flex flex-col gap-6">
        {cycles.map((cy) => (
          <section key={cy.cycle} aria-label={`Ciclo de ${formatCompetence(cy.cycle)}`}>
            <CycleCard space={c.space} b={cy} label={`Ciclo de ${formatCompetence(cy.cycle)}`}>
              <h3 className="mt-5 text-sm font-semibold">Extrato</h3>
              <ul className="mt-2 divide-y text-sm">
                {cy.ledger.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate">{ledgerLabel(e, checkIn)}</p>
                      <p className="tabular text-xs text-muted-foreground">{local(e.at, tz).toFormat(e.kind === 'booking' ? "dd/MM 'às' HH:mm" : 'dd/MM')}</p>
                    </div>
                    <span className={`tabular shrink-0 font-medium ${e.minutes < 0 ? 'text-muted-foreground' : 'text-success'}`}>
                      {e.minutes > 0 ? '+' : ''}
                      {hours(e.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </CycleCard>
          </section>
        ))}
      </div>
    </>
  );
}
