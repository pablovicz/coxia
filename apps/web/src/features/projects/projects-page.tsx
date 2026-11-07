import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FolderKanban, Users } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/input';
import { api, type ProjectListItem } from '@/lib/api';
import { formatBRL } from '@/lib/format';
import { PROJECT_STATUS } from './status';

export function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectListItem[]>('/projects') });
  const open = (projects.data ?? []).filter((p) => p.status !== 'closed');
  const closed = (projects.data ?? []).filter((p) => p.status === 'closed');

  return (
    <>
      <PageHeader
        eyebrow="Workspaces"
        title="Projetos em movimento."
        description="Grupos do WhatsApp transformados em planejamento organizado."
      />

      {projects.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Carregando projetos">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : projects.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os projetos.
        </p>
      ) : projects.data.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Nenhum projeto ativo">
          Os projetos nascem no WhatsApp: crie um grupo “PROJETO - Nome” e adicione o número da Coxia.
        </EmptyState>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Projetos ativos">
            {open.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </ul>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum projeto ativo no momento.</p> : null}

          {closed.length ? (
            <section className="mt-8" aria-labelledby="encerrados">
              <h2 id="encerrados" className="mb-3 text-sm font-semibold text-muted-foreground">
                Encerrados
              </h2>
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {closed.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function ProjectCard({ project: p }: { project: ProjectListItem }) {
  const status = PROJECT_STATUS[p.status];
  const tasks = p.openTasks ? `${p.openTasks} tarefa${p.openTasks > 1 ? 's' : ''} em aberto` : 'Nenhuma tarefa em aberto';
  return (
    <li>
      <Link
        to={`/projetos/${p.id}`}
        className="group block rounded-lg"
      >
        <Card className="flex h-full flex-col gap-3 p-5 transition-colors group-hover:border-primary/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold leading-tight">{p.title}</p>
              {p.groupName ? (
                <p className="mt-1 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                  <Users size={14} aria-hidden className="shrink-0" />
                  <span className="truncate">{p.groupName}</span>
                </p>
              ) : null}
            </div>
            <ChevronRight size={18} aria-hidden className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {p.toReview ? <Badge variant="info">{p.toReview} para revisar</Badge> : null}
            {p.overdueTasks ? <Badge variant="late">! {p.overdueTasks} atrasada{p.overdueTasks > 1 ? 's' : ''}</Badge> : null}
          </div>
          <p className="mt-auto text-sm text-muted-foreground">
            {tasks} · <span className="tabular whitespace-nowrap">{formatBRL(p.paidCents)}</span> pagos
            {p.estimatedBudgetCents !== null ? (
              <>
                {' '}
                de <span className="tabular whitespace-nowrap">{formatBRL(p.estimatedBudgetCents)}</span>
              </>
            ) : null}
          </p>
        </Card>
      </Link>
    </li>
  );
}
