import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FolderKanban, ListChecks, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { DateTime } from 'luxon';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { api, canManage, type ProjectListItem } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { NewProjectDialog } from './new-project-dialog';
import { formatBRL, todayIn } from '@coxia/ui/lib/format';
import { cn } from '@coxia/ui/lib/utils';
import { PROJECT_STATUS } from './status';

type Tab = 'andamento' | 'aguardando' | 'encerrados';

const TABS: Array<{ id: Tab; label: string; empty: string }> = [
  { id: 'andamento', label: 'Em andamento', empty: 'Nenhum projeto em andamento no momento.' },
  { id: 'aguardando', label: 'Aguardando', empty: 'Nenhum projeto com início marcado para o futuro.' },
  { id: 'encerrados', label: 'Encerrados', empty: 'Nenhum projeto encerrado ainda.' },
];

/** Encerrado; aguardando (início no futuro); ou em andamento (o resto). */
export function projectTab(p: Pick<ProjectListItem, 'status' | 'startsOn'>, today: string): Tab {
  if (p.status === 'closed') return 'encerrados';
  return p.startsOn && p.startsOn > today ? 'aguardando' : 'andamento';
}

export function ProjectsPage() {
  const { session } = useAuth();
  const admin = canManage(session?.user.role);
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const today = todayIn(tz);
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.id === params.get('aba')) ? (params.get('aba') as Tab) : 'andamento';
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectListItem[]>('/projects') });
  const all = projects.data ?? [];
  const byTab = (t: Tab) => all.filter((p) => projectTab(p, today) === t);
  const list =
    tab === 'aguardando'
      ? byTab(tab).sort((a, b) => (a.startsOn ?? '').localeCompare(b.startsOn ?? ''))
      : byTab(tab);
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <>
      <PageHeader
        eyebrow="Workspaces"
        title="Projetos em movimento."
        description="Grupos do WhatsApp transformados em planejamento organizado."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/tarefas">
                <ListChecks aria-hidden /> Tarefas
              </Link>
            </Button>
            {admin ? (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> Novo projeto
              </Button>
            ) : null}
          </div>
        }
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
      ) : all.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Nenhum projeto ativo">
          Crie aqui em “Novo projeto” (a Coxia monta o grupo no WhatsApp) ou crie no WhatsApp um grupo “PROJETO - Nome” com o número da Coxia.
        </EmptyState>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Situação dos projetos"
            className="mb-4 grid grid-cols-3 gap-1 rounded-md border bg-card p-1 sm:inline-grid sm:w-auto"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="panel-projetos"
                onClick={() => setParams(t.id === 'andamento' ? {} : { aba: t.id }, { replace: true })}
                className={cn(
                  'min-h-11 rounded-sm px-3 text-sm font-medium text-muted-foreground sm:px-4 lg:min-h-9',
                  tab === t.id && 'bg-primary text-primary-foreground',
                )}
              >
                {t.label} <span className="tabular opacity-80">({byTab(t.id).length})</span>
              </button>
            ))}
          </div>

          <div id="panel-projetos" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {list.length ? (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={`Projetos: ${current.label}`}>
                {list.map((p) => (
                  <ProjectCard key={p.id} project={p} waiting={tab === 'aguardando'} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{current.empty}</p>
            )}
          </div>
        </>
      )}
      {creating ? <NewProjectDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function ProjectCard({ project: p, waiting }: { project: ProjectListItem; waiting: boolean }) {
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
            {waiting && p.startsOn ? (
              <Badge variant="info">Começa em {DateTime.fromISO(p.startsOn).toFormat('dd/LL/yyyy')}</Badge>
            ) : (
              <Badge variant={status.variant}>{status.label}</Badge>
            )}
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
