import { useSearchParams } from 'react-router';
import { PageHeader } from '@coxia/ui/components/empty-state';
import { TASK_COMPLEXITIES, TASK_STATUSES, type TaskComplexity, type TaskFilters, type TaskStatus } from '@/lib/api';
import { readStoredTaskStatus, TASK_STATUS_STORAGE, TaskBoard } from './task-board';

/** Nome do filtro na URL (em português, como o resto do painel). */
const PARAM: Record<keyof TaskFilters, string> = {
  status: 'situacao',
  projectId: 'projeto',
  assigneeId: 'responsavel',
  complexity: 'complexidade',
  completedBy: 'realizou',
  from: 'de',
  to: 'ate',
  q: 'busca',
};

function readFilters(params: URLSearchParams): TaskFilters {
  const f: TaskFilters = {};
  for (const [key, name] of Object.entries(PARAM) as Array<[keyof TaskFilters, string]>) {
    const v = params.get(name);
    if (v) (f as Record<string, string>)[key] = v;
  }
  if (f.status && !TASK_STATUSES.includes(f.status as TaskStatus)) delete f.status;
  // Sem aba na URL: a última escolhida neste navegador.
  if (!params.has(PARAM.status)) f.status = readStoredTaskStatus(TASK_STATUS_STORAGE.page);
  if (f.complexity && !TASK_COMPLEXITIES.includes(f.complexity as TaskComplexity)) delete f.complexity;
  return f;
}

/** Todas as tarefas da equipe: abas de situação à esquerda, filtros e tabela à direita. */
export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const onChange = (f: TaskFilters) => {
    const next: Record<string, string> = {};
    for (const [key, name] of Object.entries(PARAM) as Array<[keyof TaskFilters, string]>) if (f[key]) next[name] = f[key]!;
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader eyebrow="Equipe" title="Tarefas." description="O que precisa ser feito, por quem e em que pé está. Com ou sem projeto." />
      <TaskBoard filters={filters} onFiltersChange={onChange} statusStorageKey={TASK_STATUS_STORAGE.page} />
    </>
  );
}
