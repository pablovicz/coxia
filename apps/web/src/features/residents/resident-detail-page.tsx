import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, AtSign, CalendarClock, ChevronLeft, FileText, Mail, MessageCircle, Paperclip, Pencil, Wallet } from 'lucide-react';
import { DateTime } from 'luxon';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { IncomeDialog } from '@/features/finance/incomes';
import { api, canManage, fetchResidentFile, type ResidentDetails } from '@/lib/api';
import { formatBRL, formatCompetence, formatPhone } from '@coxia/ui/lib/format';
import { RoomIcon, roomStyle } from '@coxia/ui/lib/rooms';
import { cn } from '@coxia/ui/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { ResidentAccessCard } from './resident-access';
import { ResidentContracts } from './resident-contracts';
import { ResidentForm } from './resident-form';
import { ResidentPaymentDialog } from './resident-payment-dialog';
import { instagramUrl, ResidentPhoto, SITUATION, WEEKDAY_SHORT } from './resident-shared';

const date = (iso: string) => DateTime.fromISO(iso).toFormat('dd/LL/yyyy');
const time = (hhmm: string) => hhmm.replace(':00', 'h').replace(':', 'h');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-lg font-semibold">{value}</p>
      {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Detalhe do residente: locações (salas, com a programação de dias e horários), pagamentos mês a mês,
 * entrada (primeiro mês pago), dias de pagamento, contrato e contatos.
 */
export function ResidentDetailPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const admin = canManage(session?.user.role);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payment, setPayment] = useState<ResidentDetails['payments'][number] | null>(null);
  const details = useQuery({ queryKey: ['resident', id], queryFn: () => api<ResidentDetails>(`/residents/${id}`) });
  const d = details.data;
  const r = d?.resident;

  async function openContract() {
    if (!r?.contractUploadedAt) return;
    const tab = window.open('', '_blank');
    try {
      const blob = await fetchResidentFile(r.id, 'contract', r.contractUploadedAt);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      toast.error('Não foi possível abrir o contrato.');
    }
  }

  return (
    <>
      <Button variant="outline" asChild className="mb-4">
        <Link to="/residentes">
          <ChevronLeft aria-hidden /> Residentes
        </Link>
      </Button>

      {details.isPending ? (
        <Skeleton className="h-64" />
      ) : details.isError || !d || !r ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar o residente.
        </p>
      ) : (
        <>
          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <ResidentPhoto resident={r} className="size-20 text-2xl" />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Residente</p>
                <h1 className="truncate font-display text-3xl font-semibold sm:text-4xl">{r.name}.</h1>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant={SITUATION[d.situation].variant} title={SITUATION[d.situation].hint}>
                    {SITUATION[d.situation].label}
                  </Badge>
                  <Badge variant={r.status === 'active' ? 'active' : 'archived'}>{r.status === 'active' ? 'Ativo' : 'Desabilitado'}</Badge>
                </div>
              </div>
            </div>
            {admin ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden /> Editar
                </Button>
                <Button onClick={() => setPaying(true)}>
                  <ArrowDownLeft aria-hidden /> Registrar pagamento
                </Button>
              </div>
            ) : null}
          </header>

          <section aria-label="Resumo" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Entrada" value={d.firstPaymentMonth ? cap(formatCompetence(d.firstPaymentMonth)) : '—'} hint="Primeiro mês pago" />
            <Stat
              label="Dia de pagamento"
              value={d.paymentDays.agreed ? `Dia ${d.paymentDays.agreed}` : '—'}
              hint={d.paymentDays.observed.length ? `Pagou nos dias ${d.paymentDays.observed.join(', ')}` : 'Nenhum pagamento recebido'}
            />
            <Stat label="Total pago" value={formatBRL(d.totals.receivedCents)} />
            <Stat label="Em aberto" value={formatBRL(d.totals.openCents)} hint={SITUATION[d.situation].hint} />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
            <div className="flex flex-col gap-6">
              <ResidentContracts residentId={r.id} admin={admin} tz={tz} />
              <Card>
                <CardHeader>
                  <CardTitle>Locações e programação</CardTitle>
                  <CardDescription>Salas que ocupa, com os dias e horários das reservas semanais</CardDescription>
                </CardHeader>
                <CardContent>
                  {d.rentals.length === 0 ? (
                    <EmptyState icon={CalendarClock} title="Nenhuma sala fixa">
                      Faça uma reserva semanal na Agenda das salas com este residente como responsável.
                    </EmptyState>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {d.rentals.map((rental) => (
                        <li key={rental.space.id} style={roomStyle(rental.space.color)} className="room-bar rounded-md border bg-card p-3">
                          <p className="mb-2 flex items-center gap-2 font-semibold">
                            <RoomIcon icon={rental.space.icon} size={18} className="room-text" />
                            {rental.space.name}
                          </p>
                          <ul className="flex flex-col gap-1.5 text-sm">
                            {rental.schedule.map((s) => (
                              <li key={s.bookingId} className="flex flex-wrap items-center justify-between gap-x-3">
                                <span>
                                  <span className="font-medium">{s.weekdays.map((w) => WEEKDAY_SHORT[w] ?? w).join(', ') || 'Toda semana'}</span>
                                  <span className="tabular"> · {time(s.start)}–{time(s.end)}</span>
                                  {s.title ? <span className="text-muted-foreground"> · {s.title}</span> : null}
                                </span>
                                <span className="text-muted-foreground">
                                  {s.since ? `desde ${date(s.since)}` : ''}
                                  {s.until ? ` até ${date(s.until)}` : s.since ? ', sem fim' : ''}
                                  {s.hourlyRateCents ? ` · ${formatBRL(s.hourlyRateCents)}/h` : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pagamentos</CardTitle>
                  <CardDescription>Entradas do Financeiro ligadas a este residente, mês a mês</CardDescription>
                </CardHeader>
                <CardContent>
                  {d.payments.length === 0 ? (
                    <EmptyState icon={Wallet} title="Nenhum pagamento registrado">
                      Use “Registrar pagamento” ou escolha o residente ao lançar uma entrada no Financeiro.
                    </EmptyState>
                  ) : (
                    <ul className="divide-y">
                      {d.payments.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            disabled={!admin}
                            onClick={() => setPayment(p)}
                            aria-label={admin ? `Abrir pagamento: ${formatCompetence(p.month)}` : undefined}
                            className="-mx-2 flex w-[calc(100%+1rem)] flex-wrap items-center gap-3 rounded-md px-2 py-2.5 text-left enabled:hover:bg-muted disabled:cursor-default"
                          >
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium first-letter:uppercase">{formatCompetence(p.month)}</span>
                            <span className="block truncate text-sm text-muted-foreground">
                              {p.description}
                              {p.space ? ` · ${p.space.name}` : ''}
                              {p.receivedOn ? ` · pago em ${date(p.receivedOn)}` : ` · vence ${date(p.expectedOn)}`}
                            </span>
                          </span>
                          <span className="tabular font-semibold">{formatBRL(p.amountCents)}</span>
                          {p.proof ? <Paperclip size={16} className="text-muted-foreground" aria-label="Com comprovante" /> : null}
                          <Badge variant={p.status === 'received' ? 'active' : p.overdue ? 'late' : 'pending'}>{p.status === 'received' ? 'Pago' : p.overdue ? 'Atrasado' : 'Previsto'}</Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <aside className="flex flex-col gap-6">
              <ResidentAccessCard residentId={r.id} email={r.email} admin={admin} tz={tz} />
              <Card>
                <CardHeader>
                  <CardTitle>Contato</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <a className="-my-1 flex min-h-11 items-center gap-2 font-medium text-primary underline-offset-4 hover:underline" href={`https://wa.me/${r.contact.phone}`} target="_blank" rel="noreferrer">
                    <MessageCircle size={16} aria-hidden /> <span className="tabular">{formatPhone(r.contact.phone)}</span>
                  </a>
                  {r.instagram ? (
                    <a className="-my-1 flex min-h-11 items-center gap-2 font-medium text-primary underline-offset-4 hover:underline" href={instagramUrl(r.instagram)} target="_blank" rel="noreferrer">
                      <AtSign size={16} aria-hidden /> {r.instagram}
                    </a>
                  ) : null}
                  {r.email ? (
                    <a className="-my-1 flex min-h-11 items-center gap-2 font-medium text-primary underline-offset-4 hover:underline" href={`mailto:${r.email}`}>
                      <Mail size={16} aria-hidden /> <span className="truncate">{r.email}</span>
                    </a>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Contrato anexado</CardTitle>
                </CardHeader>
                <CardContent>
                  {r.contractUploadedAt ? (
                    <Button variant="outline" onClick={openContract} className="w-full justify-start">
                      <FileText aria-hidden /> <span className="truncate">{r.contractFileName ?? 'Abrir contrato'}</span>
                    </Button>
                  ) : (
                    <p className={cn('text-sm text-muted-foreground')}>Nenhum contrato anexado{admin ? '. Anexe em “Editar”.' : '.'}</p>
                  )}
                </CardContent>
              </Card>
              {r.description ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Descrição</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-line text-sm">{r.description}</p>
                  </CardContent>
                </Card>
              ) : null}
            </aside>
          </div>

          {editing ? <ResidentForm resident={r} onClose={() => setEditing(false)} /> : null}
          {payment ? <ResidentPaymentDialog payment={payment} residentId={r.id} tz={tz} onClose={() => setPayment(null)} /> : null}
          {paying ? <IncomeDialog tz={tz} resident={{ contactId: r.contactId, name: r.name }} onClose={() => setPaying(false)} /> : null}
        </>
      )}
    </>
  );
}
