import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FolderKanban, ReceiptText, Settings } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { ThemeSwitch } from '@/components/theme-switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type Space } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export function ProjectsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Workspaces"
        title="Projetos em movimento."
        description="Grupos do WhatsApp transformados em planejamento organizado."
      />
      <EmptyState icon={FolderKanban} title="Nenhum projeto ativo">
        Os projetos nascem no WhatsApp: crie um grupo “PROJETO - Nome” e adicione o número da Coxia.
      </EmptyState>
    </>
  );
}

export function AgendaPage() {
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') });
  return (
    <>
      <PageHeader eyebrow="Espaços da casa" title="Agenda das salas." description="Horários, disponibilidade e reservas sem conflitos." />
      <div className="mb-4 flex flex-wrap gap-2" role="list" aria-label="Salas">
        {(spaces.data ?? []).map((s) => (
          <span key={s.id} role="listitem" className="rounded-full border bg-card px-3 py-1.5 text-sm font-medium">
            {s.name}
          </span>
        ))}
      </div>
      <EmptyState icon={CalendarDays} title="Nenhuma reserva nesta semana">
        Peça pelo WhatsApp — “Reserva a sala grande na sexta das 14h às 17h” — ou use o painel quando a Etapa 2 chegar.
      </EmptyState>
    </>
  );
}

export function BillsPage() {
  return (
    <>
      <PageHeader eyebrow="Cuidados recorrentes" title="Contas e lembretes." description="A Coxia avisa um dia antes e acompanha cada mês." />
      <EmptyState icon={ReceiptText} title="Nenhuma ocorrência gerada">
        Aluguel, energia, água, internet e telefone já estão cadastrados; as competências mensais entram na Etapa 2.
      </EmptyState>
    </>
  );
}

export function SettingsPage() {
  const { session } = useAuth();
  return (
    <>
      <PageHeader eyebrow="Organização" title="Configurações." description="Preferências da casa e da sua conta." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aparência</CardTitle>
            <CardDescription>Claro, escuro ou seguindo o dispositivo</CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSwitch />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Organização</CardTitle>
            <CardDescription>{session?.organization.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Fuso horário</dt>
              <dd className="font-mono text-[13px]">{session?.organization.timezone}</dd>
              <dt className="text-muted-foreground">Seu papel</dt>
              <dd>{session?.user.role}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
      <div className="mt-4">
        <EmptyState icon={Settings} title="Mais ajustes em breve">
          Salas, horários de funcionamento, contas e destinatários dos avisos serão editáveis aqui.
        </EmptyState>
      </div>
    </>
  );
}
