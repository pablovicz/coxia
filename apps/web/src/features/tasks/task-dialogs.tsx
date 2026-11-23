import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field, Select } from '@coxia/ui/components/ui/field';
import { Input, Skeleton, Textarea } from '@coxia/ui/components/ui/input';
import { local } from '@coxia/ui/lib/format';
import { MemberCheckbox } from '@/components/member-checkbox';
import { UserAvatar } from '@/components/user-avatar';
import { ProjectPicker } from '@/features/projects/project-picker';
import {
  api,
  apiSend,
  canBook,
  canManage,
  type Member,
  TASK_COMPLEXITIES,
  TASK_COMPLEXITY,
  TASK_STATE,
  type TaskComplexity,
  type TaskDetail,
} from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export const dateBr = (iso: string) => DateTime.fromISO(iso).toFormat('dd/LL/yyyy');

const useTz = () => useAuth().session?.organization.timezone ?? 'America/Sao_Paulo';

/** Depois de mudar uma tarefa: tabelas (tela e projeto) e o detalhe aberto recarregam. */
function useTaskMutation<V>(fn: (v: V) => Promise<TaskDetail | unknown>, success: (v: V) => string, after?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, v) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      if (data && typeof data === 'object' && 'id' in data) qc.setQueryData(['task', (data as TaskDetail).id], data);
      toast.success(success(v));
      after?.();
    },
    onError: (e) => toast.error(e.message),
  });
}

type FormStatus = 'pending' | 'in_progress';

/** Criar ou editar tarefa. `projectId` já vem preenchido quando aberta pela tela do projeto. */
export function TaskFormDialog({
  task,
  projectId,
  onClose,
  onSaved,
}: {
  task?: TaskDetail;
  projectId?: string | null;
  onClose: () => void;
  onSaved?: (t: TaskDetail) => void;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [complexity, setComplexity] = useState<TaskComplexity>(task?.complexity ?? 'medium');
  const [status, setStatus] = useState<FormStatus>(task && task.status !== 'done' ? task.status : 'pending');
  const [project, setProject] = useState<string | null>(task ? (task.project?.id ?? null) : (projectId ?? null));
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assignees.map((a) => a.memberId) ?? []);
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: () => api<Member[]>('/organization/members') });

  const save = useTaskMutation(
    () => {
      const body = { title: title.trim(), description: description.trim() || null, complexity, projectId: project, assigneeIds, ...(task?.status === 'done' ? {} : { status }) };
      return task ? apiSend<TaskDetail>(`/tasks/${task.id}`, 'PATCH', body) : apiSend<TaskDetail>('/tasks', 'POST', body);
    },
    () => (task ? 'Tarefa atualizada.' : 'Tarefa criada.'),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Informe o título da tarefa');
    setError(null);
    save.mutate(undefined, {
      onSuccess: (t) => {
        onClose();
        if (!task) onSaved?.(t as TaskDetail);
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      size="wide"
      title={task ? 'Editar tarefa' : 'Nova tarefa'}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="task-form" loading={save.isPending}>
            {task ? 'Salvar' : 'Criar tarefa'}
          </Button>
        </div>
      }
    >
      <form id="task-form" onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Field label="Título" error={error}>
            {(id, describedBy) => <Input id={id} autoFocus maxLength={500} value={title} aria-describedby={describedBy} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Descrição" hint="Opcional">
            {(id, describedBy) => <Textarea id={id} rows={4} maxLength={4000} value={description} aria-describedby={describedBy} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Complexidade">
              {(id) => (
                <Select id={id} value={complexity} onChange={(e) => setComplexity(e.target.value as TaskComplexity)}>
                  {TASK_COMPLEXITIES.map((c) => (
                    <option key={c} value={c}>
                      {TASK_COMPLEXITY[c].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {task?.status === 'done' ? null : (
              <Field label="Situação" hint="Para concluir, use “Concluir”">
                {(id, describedBy) => (
                  <Select id={id} value={status} aria-describedby={describedBy} onChange={(e) => setStatus(e.target.value as FormStatus)}>
                    <option value="pending">{TASK_STATE.pending.label}</option>
                    <option value="in_progress">{TASK_STATE.in_progress.label}</option>
                  </Select>
                )}
              </Field>
            )}
          </div>
          <ProjectPicker label="Projeto" value={project} onChange={setProject} />
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Responsáveis</legend>
          {members.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="grid max-h-80 gap-0.5 overflow-y-auto rounded-sm border p-2">
              {(members.data ?? []).map((m) => (
                <MemberCheckbox
                  key={m.memberId}
                  userId={m.userId}
                  name={m.name}
                  avatarUpdatedAt={m.avatarUpdatedAt}
                  checked={assigneeIds.includes(m.memberId)}
                  onChange={(v) => setAssigneeIds((ids) => (v ? [...ids, m.memberId] : ids.filter((x) => x !== m.memberId)))}
                />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Opcional. Pode marcar mais de um.</p>
        </fieldset>
      </form>
    </Dialog>
  );
}

/** Encerramento: data de realização (padrão hoje) e quem da equipe realizou. */
export function CompleteTaskDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const tz = useTz();
  const { session } = useAuth();
  const [completedOn, setCompletedOn] = useState(local(new Date(), tz).toISODate()!);
  const [memberIds, setMemberIds] = useState<string[]>(session?.user.memberId ? [session.user.memberId] : []);
  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: () => api<Member[]>('/organization/members') });
  const done = useTaskMutation(
    () => apiSend<TaskDetail>(`/tasks/${task.id}/complete`, 'POST', { completedOn, memberIds }),
    () => `Concluída: ${task.title}.`,
    onClose,
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Concluir tarefa"
      description={task.title}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={done.isPending} disabled={!completedOn} onClick={() => done.mutate(undefined)}>
            <CheckCircle2 aria-hidden /> Concluir
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Data de realização">
          {(id) => <Input id={id} type="date" required value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Quem realizou</legend>
          {members.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="grid gap-0.5">
              {(members.data ?? []).map((m) => (
                <MemberCheckbox
                  key={m.memberId}
                  userId={m.userId}
                  name={m.name}
                  avatarUpdatedAt={m.avatarUpdatedAt}
                  checked={memberIds.includes(m.memberId)}
                  onChange={(v) => setMemberIds((ids) => (v ? [...ids, m.memberId] : ids.filter((x) => x !== m.memberId)))}
                />
              ))}
            </div>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}

/** Detalhe da tarefa: dados, ações (editar, iniciar, concluir, reabrir, apagar) e observações da equipe. */
export function TaskDetailDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { session } = useAuth();
  const tz = useTz();
  const canEdit = canBook(session?.user.role);
  const admin = canManage(session?.user.role);
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState('');
  const detail = useQuery({ queryKey: ['task', taskId], queryFn: () => api<TaskDetail>(`/tasks/${taskId}`) });
  const t = detail.data;

  const start = useTaskMutation(
    (task: TaskDetail) =>
      apiSend<TaskDetail>(`/tasks/${task.id}`, 'PATCH', {
        title: task.title,
        description: task.description,
        complexity: task.complexity,
        projectId: task.project?.id ?? null,
        assigneeIds: task.assignees.map((a) => a.memberId),
        status: 'in_progress',
      }),
    (task) => `Em andamento: ${task.title}.`,
  );
  const reopen = useTaskMutation((task: TaskDetail) => apiSend<TaskDetail>(`/tasks/${task.id}/reopen`, 'POST'), (task) => `Reaberta: ${task.title}.`);
  const remove = useTaskMutation((task: TaskDetail) => apiSend(`/tasks/${task.id}`, 'DELETE'), (task) => `Tarefa apagada: ${task.title}.`, onClose);
  const addNote = useTaskMutation(
    (body: string) => apiSend<TaskDetail>(`/tasks/${taskId}/notes`, 'POST', { body }),
    () => 'Observação adicionada.',
    () => setNote(''),
  );
  const removeNote = useTaskMutation((noteId: string) => apiSend<TaskDetail>(`/tasks/${taskId}/notes/${noteId}`, 'DELETE'), () => 'Observação apagada.');

  if (editing && t) return <TaskFormDialog task={t} onClose={() => setEditing(false)} />;
  if (completing && t) return <CompleteTaskDialog task={t} onClose={() => setCompleting(false)} />;

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      size="wide"
      title={t?.title ?? 'Tarefa'}
      description={t ? `Criada em ${local(t.createdAt, tz).toFormat('dd/LL/yyyy')}` : undefined}
      footer={
        t && canEdit ? (
          <div className="flex w-full flex-wrap justify-between gap-2">
            <div>
              {admin ? (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  loading={remove.isPending}
                  onClick={() => window.confirm(`Apagar a tarefa “${t.title}”? As observações também serão apagadas.`) && remove.mutate(t)}
                >
                  <Trash2 aria-hidden /> Apagar
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Editar
              </Button>
              {t.status === 'pending' ? (
                <Button variant="outline" loading={start.isPending} onClick={() => start.mutate(t)}>
                  <Play aria-hidden /> Iniciar
                </Button>
              ) : null}
              {t.status === 'done' ? (
                <Button variant="outline" loading={reopen.isPending} onClick={() => reopen.mutate(t)}>
                  <RotateCcw aria-hidden /> Reabrir
                </Button>
              ) : (
                <Button onClick={() => setCompleting(true)}>
                  <CheckCircle2 aria-hidden /> Concluir
                </Button>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      {detail.isPending ? (
        <Skeleton className="h-40" />
      ) : detail.isError || !t ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar a tarefa.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Situação</dt>
              <dd>
                <Badge variant={TASK_STATE[t.status].variant}>{TASK_STATE[t.status].label}</Badge>
              </dd>
              <dt className="text-muted-foreground">Complexidade</dt>
              <dd>
                <Badge variant={TASK_COMPLEXITY[t.complexity].variant}>{TASK_COMPLEXITY[t.complexity].label}</Badge>
              </dd>
              <dt className="text-muted-foreground">Projeto</dt>
              <dd>
                {t.project ? (
                  <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/projetos/${t.project.id}`}>
                    {t.project.title}
                  </Link>
                ) : (
                  'Sem projeto'
                )}
              </dd>
              <dt className="text-muted-foreground">Responsáveis</dt>
              <dd className="flex flex-col gap-1.5">
                {t.assignees.length
                  ? t.assignees.map((a) => (
                      <span key={a.memberId} className="flex items-center gap-2">
                        <UserAvatar userId={a.userId} name={a.name} version={a.avatarUpdatedAt} className="size-6 text-[10px]" /> {a.name}
                      </span>
                    ))
                  : 'Ninguém definido'}
              </dd>
              {t.status === 'done' ? (
                <>
                  <dt className="text-muted-foreground">Realizada em</dt>
                  <dd>{t.completedOn ? dateBr(t.completedOn) : '—'}</dd>
                  <dt className="text-muted-foreground">Quem realizou</dt>
                  <dd className="flex flex-col gap-1.5">
                    {t.completers.length
                      ? t.completers.map((c) => (
                          <span key={c.memberId} className="flex items-center gap-2">
                            <UserAvatar userId={c.userId} name={c.name} version={c.avatarUpdatedAt} className="size-6 text-[10px]" /> {c.name}
                          </span>
                        ))
                      : 'Não informado'}
                  </dd>
                </>
              ) : null}
            </dl>
            {t.description ? (
              <div>
                <p className="mb-1 text-sm font-medium">Descrição</p>
                <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{t.description}</p>
              </div>
            ) : null}
          </div>

          <section aria-labelledby="task-notes" className="flex flex-col gap-3">
            <h3 id="task-notes" className="text-sm font-medium">
              Observações {t.notes.length ? <span className="tabular text-muted-foreground">({t.notes.length})</span> : null}
            </h3>
            {t.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma observação ainda.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {t.notes.map((n) => {
                  const mine = !!n.author && n.author.userId === session?.user.id;
                  return (
                    <li key={n.id} className="flex gap-3">
                      {n.author ? (
                        <UserAvatar userId={n.author.userId} name={n.author.name} version={n.author.avatarUpdatedAt} className="size-8 text-[11px]" />
                      ) : (
                        <span className="size-8 shrink-0 rounded-full bg-muted" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1 rounded-md bg-muted/60 px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold">{n.author?.name ?? 'Equipe'}</p>
                          <span className="shrink-0 text-xs text-muted-foreground">{local(n.createdAt, tz).toFormat("dd/LL 'às' HH:mm")}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                        {canEdit && (mine || admin) ? (
                          <button
                            type="button"
                            className="mt-1 text-xs text-muted-foreground hover:text-destructive"
                            disabled={removeNote.isPending}
                            onClick={() => window.confirm('Apagar esta observação?') && removeNote.mutate(n.id)}
                          >
                            Apagar
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) addNote.mutate(note.trim());
                }}
              >
                <Field label="Nova observação">
                  {(id) => <Textarea id={id} rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Escreva uma observação para a equipe" />}
                </Field>
                <Button type="submit" variant="outline" className="self-end" disabled={!note.trim()} loading={addNote.isPending}>
                  Adicionar observação
                </Button>
              </form>
            ) : null}
          </section>
        </div>
      )}
    </Dialog>
  );
}
