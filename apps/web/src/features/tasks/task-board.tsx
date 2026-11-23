import { useQuery } from '@tanstack/react-query';
import { ListChecks, MessageSquareText, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@coxia/ui/components/ui/card';
import { Select } from '@coxia/ui/components/ui/field';
import { Input, Skeleton } from '@coxia/ui/components/ui/input';
import { cn } from '@coxia/ui/lib/utils';
import { UserAvatar } from '@/components/user-avatar';
import { useProjects } from '@/features/projects/project-picker';
import { ResidentPhoto } from '@/features/residents/resident-shared';
import {
  api,
  canBook,
  type Member,
  type ResidentListItem,
  TASK_COMPLEXITIES,
  TASK_COMPLEXITY,
  TASK_STATE,
  TASK_STATUSES,
  type Task,
  type TaskFilters,
  type TaskList,
  tasksPath,
} from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { dateBr, TaskDetailDialog, TaskFormDialog } from './task-dialogs';

/**
 * Abas de situação + filtros + tabela de tarefas. Na tela "Tarefas" os filtros ficam na URL;
 * na tela do projeto, `projectId` fixa o projeto (sem coluna nem filtro de projeto).
 */
export function TaskBoard({
  filters,
  onFiltersChange,
  projectId,
  layout = 'page',
}: {
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters) => void;
  projectId?: string;
  /** page: abas na lateral esquerda; card: abas em cima (tela do projeto). */
  layout?: 'page' | 'card';
}) {
  const { session } = useAuth();
  const canEdit = canBook(session?.user.role);
  const { status, ...rest } = filters;
  const query = { ...rest, ...(projectId ? { projectId } : {}) };
  const list = useQuery({ queryKey: ['tasks', query], queryFn: () => api<TaskList>(tasksPath(query)) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const counts = list.data?.counts;
  const total = counts ? counts.pending + counts.in_progress + counts.done : 0;
  const tasks = (list.data?.tasks ?? []).filter((t) => !status || t.status === status);
  const set = (patch: Partial<TaskFilters>) => onFiltersChange({ ...filters, ...patch });

  const tabs = (
    <div
      role="tablist"
      aria-label="Situação das tarefas"
      aria-orientation={layout === 'page' ? 'vertical' : 'horizontal'}
      className={cn(
        'flex gap-1 rounded-md border bg-card p-1',
        layout === 'page' ? 'overflow-x-auto lg:flex-col lg:self-start' : 'overflow-x-auto sm:inline-flex sm:self-start',
      )}
    >
      {([undefined, ...TASK_STATUSES] as const).map((s) => (
        <button
          key={s ?? 'all'}
          type="button"
          role="tab"
          aria-selected={status === s}
          onClick={() => set({ status: s })}
          className={cn(
            'flex min-h-11 shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-sm px-3 text-left text-sm font-medium text-muted-foreground lg:min-h-9',
            status === s && 'bg-primary text-primary-foreground',
          )}
        >
          {s ? TASK_STATE[s].tab : 'Todas'}
          <span className="tabular opacity-80">{counts ? (s ? counts[s] : total) : '·'}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className={cn('grid gap-4', layout === 'page' && 'lg:grid-cols-[13rem_1fr] lg:items-start')}>
      {layout === 'page' ? tabs : null}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {layout === 'card' ? tabs : <span />}
          {canEdit ? (
            <Button className="sm:self-start" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Nova tarefa
            </Button>
          ) : null}
        </div>
        <TaskFiltersBar filters={filters} onChange={set} hideProject={!!projectId} />
        {list.isPending ? (
          <div className="grid gap-2" aria-busy="true" aria-label="Carregando tarefas">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar as tarefas.
          </p>
        ) : tasks.length === 0 ? (
          <EmptyState icon={ListChecks} title={total === 0 && !hasFilters(rest) ? 'Nenhuma tarefa ainda' : 'Nenhuma tarefa encontrada'}>
            {total === 0 && !hasFilters(rest) ? 'Cadastre as tarefas para acompanhar quem faz o quê.' : 'Mude a aba ou os filtros para ver outras tarefas.'}
          </EmptyState>
        ) : (
          <TasksTable tasks={tasks} showProject={!projectId} onOpen={setOpenId} />
        )}
      </div>
      {openId ? <TaskDetailDialog taskId={openId} onClose={() => setOpenId(null)} /> : null}
      {creating ? <TaskFormDialog projectId={projectId ?? null} onClose={() => setCreating(false)} onSaved={(t) => setOpenId(t.id)} /> : null}
    </div>
  );
}

/** Contagens por situação das tarefas do projeto (mesma consulta da tabela sem filtros). */
export function useProjectTaskCounts(projectId: string) {
  const query: TaskFilters = { projectId };
  return useQuery({ queryKey: ['tasks', query], queryFn: () => api<TaskList>(tasksPath(query)), enabled: !!projectId });
}

/** Tarefas do projeto na tela do projeto: a mesma tabela da tela "Tarefas", com o projeto fixo. */
export function ProjectTasksCard({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState<TaskFilters>({});
  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Tarefas</CardTitle>
          <CardDescription>
            O que falta fazer no projeto.{' '}
            <Link className="text-primary underline-offset-4 hover:underline" to={`/tarefas?projeto=${projectId}`}>
              Ver em Tarefas
            </Link>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <TaskBoard filters={filters} onFiltersChange={setFilters} projectId={projectId} layout="card" />
      </CardContent>
    </Card>
  );
}

const hasFilters = (f: Omit<TaskFilters, 'status'>) => Object.entries(f).some(([k, v]) => k !== 'projectId' && !!v);

function TaskFiltersBar({ filters: f, onChange, hideProject }: { filters: TaskFilters; onChange: (p: Partial<TaskFilters>) => void; hideProject: boolean }) {
  const { session } = useAuth();
  const projects = useProjects();
  const residents = useQuery({ queryKey: ['residents'], queryFn: () => api<ResidentListItem[]>('/residents'), enabled: canBook(session?.user.role) });
  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: () => api<Member[]>('/organization/members') });
  const active = Object.entries(f).some(([k, v]) => k !== 'status' && !!v);
  const sortedProjects = [...(projects.data ?? [])].sort(
    (a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.title.localeCompare(b.title, 'pt-BR'),
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Filtros">
      <Input type="search" aria-label="Buscar tarefa" placeholder="Buscar tarefa" value={f.q ?? ''} onChange={(e) => onChange({ q: e.target.value || undefined })} />
      {hideProject ? null : (
        <Select aria-label="Projeto" value={f.projectId ?? ''} onChange={(e) => onChange({ projectId: e.target.value || undefined })}>
          <option value="">Todos os projetos</option>
          <option value="none">Sem projeto</option>
          {sortedProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.status === 'closed' ? ' (encerrado)' : ''}
            </option>
          ))}
        </Select>
      )}
      <Select aria-label="Responsável" value={f.residentId ?? ''} onChange={(e) => onChange({ residentId: e.target.value || undefined })}>
        <option value="">Todos os responsáveis</option>
        {(residents.data ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Complexidade" value={f.complexity ?? ''} onChange={(e) => onChange({ complexity: (e.target.value || undefined) as TaskFilters['complexity'] })}>
        <option value="">Toda complexidade</option>
        {TASK_COMPLEXITIES.map((c) => (
          <option key={c} value={c}>
            {TASK_COMPLEXITY[c].label}
          </option>
        ))}
      </Select>
      <Select aria-label="Quem realizou" value={f.completedBy ?? ''} onChange={(e) => onChange({ completedBy: e.target.value || undefined })}>
        <option value="">Realizada por qualquer um</option>
        {(members.data ?? []).map((m) => (
          <option key={m.memberId} value={m.memberId}>
            {m.name}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="shrink-0">De</span>
        <Input type="date" aria-label="Data inicial" value={f.from ?? ''} onChange={(e) => onChange({ from: e.target.value || undefined })} />
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="shrink-0">Até</span>
        <Input type="date" aria-label="Data final" value={f.to ?? ''} onChange={(e) => onChange({ to: e.target.value || undefined })} />
      </label>
      {active ? (
        <Button
          variant="ghost"
          className="justify-self-start"
          onClick={() => onChange({ q: undefined, projectId: undefined, residentId: undefined, complexity: undefined, completedBy: undefined, from: undefined, to: undefined })}
        >
          <X aria-hidden /> Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}

function Assignees({ task: t }: { task: Task }) {
  if (!t.assignees.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {t.assignees.map((a) => (
        <span key={a.id} className="flex items-center gap-1.5">
          <ResidentPhoto resident={a} className="size-6 text-[10px]" />
          <span className="whitespace-nowrap">{a.name}</span>
        </span>
      ))}
    </span>
  );
}

function Completers({ task: t }: { task: Task }) {
  if (!t.completers.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {t.completers.map((c) => (
        <span key={c.memberId} className="flex items-center gap-1.5">
          <UserAvatar userId={c.userId} name={c.name} version={c.avatarUpdatedAt} className="size-6 text-[10px]" />
          <span className="whitespace-nowrap">{c.name.split(' ')[0]}</span>
        </span>
      ))}
    </span>
  );
}

function NotesCount({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={`${n} observaç${n > 1 ? 'ões' : 'ão'}`}>
      <MessageSquareText size={14} aria-hidden />
      <span className="tabular">{n}</span>
      <span className="sr-only">observaç{n > 1 ? 'ões' : 'ão'}</span>
    </span>
  );
}

/** Tabela no desktop; lista de cartões no celular. A linha abre o detalhe da tarefa. */
export function TasksTable({ tasks, showProject, onOpen }: { tasks: Task[]; showProject: boolean; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Tarefa
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Responsáveis
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Complexidade
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Situação
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Realizada em
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Quem realizou
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tasks.map((t) => (
              <tr key={t.id} className="cursor-pointer align-top hover:bg-muted/40" onClick={() => onOpen(t.id)}>
                <td className="max-w-md px-4 py-3">
                  <button type="button" className="text-left font-medium hover:underline" onClick={(e) => (e.stopPropagation(), onOpen(t.id))}>
                    {t.title}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    {showProject && t.project ? (
                      <Link className="hover:text-primary hover:underline" to={`/projetos/${t.project.id}`} onClick={(e) => e.stopPropagation()}>
                        {t.project.title}
                      </Link>
                    ) : null}
                    <NotesCount n={t.notesCount} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Assignees task={t} />
                </td>
                <td className="px-4 py-3">
                  <Badge variant={TASK_COMPLEXITY[t.complexity].variant}>{TASK_COMPLEXITY[t.complexity].label}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={TASK_STATE[t.status].variant}>{TASK_STATE[t.status].label}</Badge>
                </td>
                <td className="tabular whitespace-nowrap px-4 py-3">{t.completedOn ? dateBr(t.completedOn) : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-3">
                  <Completers task={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-2 md:hidden" aria-label="Tarefas">
        {tasks.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onOpen(t.id)} className="flex w-full flex-col gap-2 rounded-lg border bg-card p-4 text-left">
              <span className="font-medium">{t.title}</span>
              {showProject && t.project ? <span className="text-xs text-muted-foreground">{t.project.title}</span> : null}
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={TASK_STATE[t.status].variant}>{TASK_STATE[t.status].label}</Badge>
                <Badge variant={TASK_COMPLEXITY[t.complexity].variant}>Complexidade {TASK_COMPLEXITY[t.complexity].label.toLowerCase()}</Badge>
                <NotesCount n={t.notesCount} />
              </span>
              {t.assignees.length ? (
                <span className="text-sm">
                  <Assignees task={t} />
                </span>
              ) : null}
              {t.completedOn ? (
                <span className="text-sm text-muted-foreground">
                  Realizada em {dateBr(t.completedOn)}
                  {t.completers.length ? ` por ${t.completers.map((c) => c.name.split(' ')[0]).join(', ')}` : ''}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
