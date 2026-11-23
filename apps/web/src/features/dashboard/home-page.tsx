import { useQuery } from '@tanstack/react-query';
import { FolderKanban, MessageCircle } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { api, canManage, type Overview, type WhatsappConnection } from '@/lib/api';
import { formatBRL, formatDueDate } from '@coxia/ui/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { TodayAgenda } from './today-agenda';

function greeting(date: Date, timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(date));
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}

export function HomePage() {
  const { session } = useAuth();
  const timezone = session?.organization.timezone ?? 'America/Sao_Paulo';
  const now = new Date();
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(now);

  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/overview'), refetchInterval: 60_000 });
  const connection = useQuery({
    queryKey: ['whatsapp', 'connection'],
    queryFn: () => api<WhatsappConnection>('/whatsapp/connection'),
    enabled: canManage(session?.user.role),
    refetchInterval: 60_000,
  });
  const o = overview.data;
  const roomsUsed = o ? new Set(o.todayBookings.map((b) => b.spaceId)).size : 0;

  return (
    <>
      <PageHeader
        eyebrow={today}
        title={`${greeting(now, timezone)}, ${session?.organization.name ?? ''}.`}
        description="Projetos, salas e contas organizados pela Coxia."
      />

      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {o ? (
          <>
            <MetricCard highlight title="Reservas de hoje" value={String(o.todayBookings.length)} caption={o.todayBookings.length ? `Em ${roomsUsed} sala${roomsUsed > 1 ? 's' : ''}` : 'Salas livres'} />
            <MetricCard title="Contas a vencer" value={String(o.billsDueSoon.length)} caption="Próximos 7 dias" />
            <MetricCard title="Atrasadas" value={String(o.billsOverdue.length)} caption={o.billsOverdue.length ? 'Precisam de atenção' : 'Tudo em dia'} />
            <MetricCard
              title="Projetos ativos"
              value={String(o.activeProjects)}
              caption={o.projectsToReview ? `${o.projectsToReview} ite${o.projectsToReview > 1 ? 'ns' : 'm'} para revisar` : 'Workspaces do WhatsApp'}
            />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)
        )}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Agenda de hoje</CardTitle>
              <CardDescription>Contas, reservas, compromissos e lembretes do dia</CardDescription>
            </div>
            <Link to="/calendario" className="-my-3 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
              Ver calendário
            </Link>
          </CardHeader>
          <CardContent>
            {overview.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Não foi possível carregar a visão geral.
              </p>
            ) : (
              <TodayAgenda bookings={o?.todayBookings} timezone={timezone} loadingBookings={overview.isPending} />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>Contas</CardTitle>
                <CardDescription>Atrasadas e a vencer em 7 dias</CardDescription>
              </div>
              <Link to="/contas" className="-my-3 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                Ver contas
              </Link>
            </CardHeader>
            <CardContent>
              {o && o.billsOverdue.length + o.billsDueSoon.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta pendente nos próximos dias.</p>
              ) : (
                <ul className="divide-y">
                  {[...(o?.billsOverdue ?? []), ...(o?.billsDueSoon ?? [])].map((b) => {
                    const due = formatDueDate(b.dueDate);
                    const late = o!.billsOverdue.includes(b);
                    return (
                      <li key={b.id} className="flex min-h-12 items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{b.recurringBill.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {due.day} {due.month} · {b.expectedAmountCents === null ? 'valor variável' : formatBRL(b.expectedAmountCents - b.paidAmountCents)}
                          </p>
                        </div>
                        <Badge variant={late ? 'late' : 'pending'}>{late ? '! Atrasada' : '◷ A vencer'}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>WhatsApp</CardTitle>
              <CardDescription>Sessão usada pela Coxia</CardDescription>
            </CardHeader>
            <CardContent>
              {connection.data ? (
                <div className="flex items-center gap-3">
                  <MessageCircle size={20} strokeWidth={1.75} aria-hidden className="text-muted-foreground" />
                  <Badge variant={connection.data.connected ? 'active' : 'late'}>{connection.data.connected ? '● Conectado' : '! Desconectado'}</Badge>
                  <span className="text-sm text-muted-foreground">via {connection.data.provider}</span>
                </div>
              ) : connection.isPending && connection.fetchStatus !== 'idle' ? (
                <Skeleton className="h-10" />
              ) : (
                <p className="text-sm text-muted-foreground">Disponível para administradoras.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {o && o.activeProjects === 0 ? (
        <div className="mt-4">
          <EmptyState icon={FolderKanban} title="Nenhum projeto ainda">
            Crie um grupo “PROJETO - Nome” no WhatsApp e adicione a Coxia. O workspace aparece aqui.
          </EmptyState>
        </div>
      ) : null}
    </>
  );
}
