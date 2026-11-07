import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FolderKanban, MessageCircle, ReceiptText } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/input';
import { api, type Space, type WhatsappConnection } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

function greeting(date: Date, timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(date));
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}

export function HomePage() {
  const { session } = useAuth();
  const timezone = session?.organization.timezone ?? 'America/Sao_Paulo';
  const now = new Date();
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(now);

  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') });
  const connection = useQuery({
    queryKey: ['whatsapp', 'connection'],
    queryFn: () => api<WhatsappConnection>('/whatsapp/connection'),
    enabled: session?.user.role === 'owner' || session?.user.role === 'admin',
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader
        eyebrow={today}
        title={`${greeting(now, timezone)}, ${session?.organization.name ?? ''}.`}
        description="Projetos, salas e contas organizados pela Coxia."
      />

      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard highlight title="Projetos ativos" value="0" caption="Workspaces entram na Etapa 3" />
        <MetricCard title="Reservas de hoje" value="0" caption={spaces.data ? `Nas ${spaces.data.length} salas` : 'Carregando salas…'} />
        <MetricCard title="Contas a vencer" value="0" caption="Próximos 7 dias" />
        <MetricCard title="Atrasadas" value="0" caption="Tudo em dia" />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Salas da casa</CardTitle>
            <CardDescription>Horário de funcionamento cadastrado</CardDescription>
          </CardHeader>
          <CardContent>
            {spaces.isPending ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : spaces.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Não foi possível carregar as salas.
              </p>
            ) : spaces.data.length === 0 ? (
              <EmptyState icon={CalendarDays} title="Nenhuma sala cadastrada">
                Cadastre as salas em Configurações para começar a receber reservas.
              </EmptyState>
            ) : (
              <ul className="divide-y">
                {spaces.data.map((s) => (
                  <li key={s.id} className="flex min-h-14 items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{s.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {s.availabilityRules[0]
                          ? `${s.availabilityRules[0].opensAt}–${s.availabilityRules[0].closesAt} · ${s.availabilityRules.length} dias por semana`
                          : 'Sem horário cadastrado'}
                      </p>
                    </div>
                    <Badge variant="active">Livre hoje</Badge>
                  </li>
                ))}
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
            {connection.isPending && connection.fetchStatus !== 'idle' ? (
              <Skeleton className="h-10" />
            ) : connection.data ? (
              <div className="flex items-center gap-3">
                <MessageCircle size={20} strokeWidth={1.75} aria-hidden className="text-muted-foreground" />
                <Badge variant={connection.data.connected ? 'active' : 'late'}>
                  {connection.data.connected ? '● Conectado' : '! Desconectado'}
                </Badge>
                <span className="text-sm text-muted-foreground">via {connection.data.provider}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Disponível para administradoras.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <EmptyState icon={FolderKanban} title="Nenhum projeto ainda">
          Crie um grupo “PROJETO - Nome” no WhatsApp e adicione a Coxia. O workspace aparece aqui.
        </EmptyState>
        <EmptyState icon={ReceiptText} title="Sem contas a vencer">
          As ocorrências mensais das contas fixas aparecem aqui, com aviso um dia antes.
        </EmptyState>
      </div>
    </>
  );
}
