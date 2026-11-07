import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileAudio, ListChecks, Paperclip, Plus } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field } from '@/components/ui/field';
import { Input, Skeleton } from '@/components/ui/input';
import {
  api,
  ApiError,
  apiSend,
  canBook,
  canManage,
  type Evidence,
  type ProjectDetail,
  type ProjectExpense,
  type ProjectSuggestion,
  type ProjectTask,
} from '@/lib/api';
import { formatBRL, local, todayIn } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { EXPENSE_STATUS, PROJECT_STATUS, TASK_STATUS } from './status';

const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Textos da Coxia usam *negrito* do WhatsApp; no painel, só o texto. */
const plain = (s: string) => s.replace(/\*/g, '');

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const role = session?.user.role;
  const project = useQuery({ queryKey: ['projects', id], queryFn: () => api<ProjectDetail>(`/projects/${id}`) });
  const [closing, setClosing] = useState(false);
  const [newTask, setNewTask] = useState(false);

  if (project.isPending) {
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Carregando projeto">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <>
        <BackLink />
        <p role="alert" className="text-sm text-destructive">
          {notFound ? 'Projeto não encontrado.' : 'Não foi possível carregar o projeto.'}
        </p>
      </>
    );
  }

  const p = project.data;
  const closed = p.status === 'closed';
  const admin = canManage(role) && !closed;
  const staff = canBook(role) && !closed;
  const today = todayIn(tz);
  const openTasks = p.tasks.filter((t) => t.status === 'open');
  const used = p.totals.paidCents + p.totals.committedCents;
  const report = p.summaries.find((s) => s.kind === 'closing');
  const status = PROJECT_STATUS[p.status];

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={p.groupName ?? 'Projeto'}
        title={p.title}
        description={p.objective ?? 'Objetivo ainda não definido: mande o briefing em áudio no grupo.'}
        action={
          admin ? (
            <Button variant="outline" onClick={() => setClosing(true)}>
              Encerrar projeto
            </Button>
          ) : null
        }
      />
      <div className="-mt-3 mb-5 flex flex-wrap gap-2">
        {closed && p.closedAt ? (
          <Badge variant="archived">Encerrado em {local(p.closedAt, tz).toFormat('dd/LL/yyyy')}</Badge>
        ) : (
          <Badge variant={status.variant}>{status.label}</Badge>
        )}
        {p.groupCheckIns && !closed ? <Badge variant="neutral">Check-in diário no grupo</Badge> : null}
      </div>

      {report ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Relatório de encerramento</CardTitle>
            <CardDescription>Gerado a partir do estado do projeto em {local(report.generatedAt, tz).toFormat("dd/LL 'às' HH:mm")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{plain(report.content)}</p>
          </CardContent>
        </Card>
      ) : null}

      <section aria-label="Resumo do projeto" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard highlight title="Tarefas abertas" value={String(openTasks.length)} caption={overdueCaption(openTasks, today)} />
        <MetricCard title="Para revisar" value={String(p.pendingReview)} caption={p.pendingReview ? 'Sugestões da Coxia' : 'Nada pendente'} />
        <MetricCard
          money
          title="Pago"
          value={formatBRL(p.totals.paidCents)}
          caption={p.totals.committedCents ? `+ ${formatBRL(p.totals.committedCents)} a pagar` : 'Com comprovante ou validado'}
        />
        <MetricCard
          money
          title="Orçamento"
          value={p.estimatedBudgetCents === null ? '—' : formatBRL(p.estimatedBudgetCents)}
          caption={p.estimatedBudgetCents ? `${Math.round((used / p.estimatedBudgetCents) * 100)}% comprometido` : 'Estimativa do briefing'}
        />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-4">
          <ReviewCard project={p} tz={tz} canReviewTasks={staff} canReviewMoney={admin} />
          <TasksCard project={p} today={today} canEdit={staff} closed={closed} onNew={() => setNewTask(true)} />
          <FinanceCard project={p} tz={tz} canEdit={admin} />
        </div>
        <div className="grid content-start gap-4">
          <BriefingCard project={p} />
          <Card>
            <CardHeader>
              <CardTitle>Decisões</CardTitle>
              <CardDescription>Registradas a partir do grupo</CardDescription>
            </CardHeader>
            <CardContent>
              {p.decisions.length ? (
                <ul className="grid gap-2 text-sm">
                  {p.decisions.map((d) => (
                    <li key={d.id} className="flex gap-2">
                      <span aria-hidden className="text-muted-foreground">
                        •
                      </span>
                      <span>
                        {d.summary} <span className="text-muted-foreground">· {local(d.decidedAt, tz).toFormat('dd/LL')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma decisão registrada.</p>
              )}
            </CardContent>
          </Card>
          {admin ? <SettingsCard project={p} /> : null}
        </div>
      </div>

      {closing ? <CloseDialog project={p} onClose={() => setClosing(false)} /> : null}
      {newTask ? <TaskDialog projectId={p.id} onClose={() => setNewTask(false)} /> : null}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/projetos" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft size={18} aria-hidden /> Projetos
    </Link>
  );
}

function overdueCaption(open: ProjectTask[], today: string) {
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;
  return overdue ? `${overdue} atrasada${overdue > 1 ? 's' : ''}` : 'Nenhuma atrasada';
}

function useProjectMutation<V>(projectId: string, fn: (v: V) => Promise<unknown>, success: (v: V) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success(success(v));
    },
    onError: (e) => toast.error(e.message),
  });
}

/** Mensagem do grupo que originou a sugestão: quem disse, quando e o trecho. */
function EvidenceLine({ e, tz }: { e: Evidence | null; tz: string }) {
  if (!e) return null;
  const who = e.authorName ?? e.authorPhone ?? 'Grupo';
  return (
    <p className="mt-1 text-[13px] text-muted-foreground">
      {e.attachmentKind === 'audio' ? <FileAudio size={13} aria-label="Áudio" className="mr-1 inline align-[-2px]" /> : null}
      <span className="font-medium">{who}</span> · {local(e.sentAt, tz).toFormat("dd/LL 'às' HH:mm")}
      {e.text ? <span className="line-clamp-2"> “{e.text}”</span> : null}
    </p>
  );
}

function ReviewItem({ kind, title, meta, evidence, tz, children }: { kind: string; title: string; meta?: string | null; evidence: Evidence | null; tz: string; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{kind}</p>
        <p className="font-medium">{title}</p>
        {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
        <EvidenceLine e={evidence} tz={tz} />
      </div>
      {children ? <div className="flex shrink-0 gap-2">{children}</div> : null}
    </li>
  );
}

const SUGGESTION: Record<ProjectSuggestion['type'], { kind: string; confirm: string; text: (s: ProjectSuggestion) => string }> = {
  decision: { kind: 'Decisão', confirm: 'Registrar', text: (s) => (s.payload.type === 'decision' ? s.payload.summary : '') },
  question: { kind: 'Pergunta em aberto', confirm: 'Resolvida', text: (s) => (s.payload.type === 'question' ? s.payload.question : '') },
  task_done: { kind: 'Tarefa concluída?', confirm: 'Concluir', text: (s) => (s.payload.type === 'task_done' ? s.payload.taskTitle : '') },
};

function ReviewCard({ project: p, tz, canReviewTasks, canReviewMoney }: { project: ProjectDetail; tz: string; canReviewTasks: boolean; canReviewMoney: boolean }) {
  const proposedTasks = p.tasks.filter((t) => t.status === 'proposed');
  const proposedMoney = p.expenses.filter((e) => e.status === 'proposed');
  const task = useProjectMutation(
    p.id,
    (v: { t: ProjectTask; status: 'open' | 'cancelled' }) => apiSend(`/projects/${p.id}/tasks/${v.t.id}`, 'PATCH', { status: v.status }),
    (v) => (v.status === 'open' ? `Tarefa aprovada: ${v.t.title}.` : 'Sugestão descartada.'),
  );
  const money = useProjectMutation(
    p.id,
    (v: { e: ProjectExpense; action: 'confirm' | 'reject' }) => apiSend(`/projects/${p.id}/expenses/${v.e.id}/review`, 'POST', { action: v.action }),
    (v) => (v.action === 'confirm' ? `${v.e.kind === 'quote' ? 'Cotação aprovada' : 'Despesa validada'}: ${v.e.description}.` : 'Lançamento rejeitado.'),
  );
  const event = useProjectMutation(
    p.id,
    (v: { s: ProjectSuggestion; decision: 'confirm' | 'reject' }) => apiSend(`/projects/${p.id}/events/${v.s.id}/review`, 'POST', { decision: v.decision }),
    (v) => (v.decision === 'confirm' ? 'Sugestão confirmada.' : 'Sugestão descartada.'),
  );
  const total = proposedTasks.length + proposedMoney.length + p.suggestions.length;
  if (total === 0) return null;

  return (
    <Card className="border-info/40">
      <CardHeader>
        <CardTitle>Para revisar</CardTitle>
        <CardDescription>A Coxia propôs a partir das mensagens do grupo. Nada disso vale até alguém confirmar.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {proposedTasks.map((t) => (
            <ReviewItem key={t.id} kind="Tarefa sugerida" title={t.title} meta={[t.assigneeName, t.dueDate ? `até ${dayMonth(t.dueDate)}` : null].filter(Boolean).join(' · ') || null} evidence={t.source} tz={tz}>
              {canReviewTasks ? (
                <>
                  <Button variant="outline" disabled={task.isPending} onClick={() => task.mutate({ t, status: 'cancelled' })}>
                    Descartar
                  </Button>
                  <Button loading={task.isPending && task.variables?.t.id === t.id && task.variables.status === 'open'} onClick={() => task.mutate({ t, status: 'open' })}>
                    Aprovar
                  </Button>
                </>
              ) : null}
            </ReviewItem>
          ))}
          {proposedMoney.map((e) => (
            <ReviewItem
              key={e.id}
              kind={e.kind === 'quote' ? 'Cotação' : e.hasProof ? 'Pagamento com comprovante' : 'Despesa'}
              title={`${e.description}${e.vendor ? ` (${e.vendor})` : ''}`}
              meta={e.amountCents === null ? 'Valor a confirmar' : formatBRL(e.amountCents)}
              evidence={e.source}
              tz={tz}
            >
              {canReviewMoney ? (
                <>
                  <Button variant="outline" onClick={() => money.mutate({ e, action: 'reject' })} disabled={money.isPending}>
                    Rejeitar
                  </Button>
                  <Button onClick={() => money.mutate({ e, action: 'confirm' })} loading={money.isPending && money.variables?.e.id === e.id && money.variables.action === 'confirm'}>
                    {e.kind === 'quote' ? 'Aprovar' : e.hasProof ? 'Validar pagamento' : 'Validar'}
                  </Button>
                </>
              ) : null}
            </ReviewItem>
          ))}
          {p.suggestions.map((s) => {
            const cfg = SUGGESTION[s.type];
            return (
              <ReviewItem key={s.id} kind={cfg.kind} title={cfg.text(s)} evidence={s.source} tz={tz}>
                {canReviewMoney ? (
                  <>
                    <Button variant="outline" onClick={() => event.mutate({ s, decision: 'reject' })} disabled={event.isPending}>
                      Descartar
                    </Button>
                    <Button onClick={() => event.mutate({ s, decision: 'confirm' })} loading={event.isPending && event.variables?.s.id === s.id && event.variables.decision === 'confirm'}>
                      {cfg.confirm}
                    </Button>
                  </>
                ) : null}
              </ReviewItem>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function TasksCard({ project: p, today, canEdit, closed, onNew }: { project: ProjectDetail; today: string; canEdit: boolean; closed: boolean; onNew: () => void }) {
  const open = p.tasks.filter((t) => t.status === 'open');
  const done = p.tasks.filter((t) => t.status === 'done');
  const update = useProjectMutation(
    p.id,
    (v: { t: ProjectTask; status: 'done' | 'open' }) => apiSend(`/projects/${p.id}/tasks/${v.t.id}`, 'PATCH', { status: v.status }),
    (v) => (v.status === 'done' ? `Concluída: ${v.t.title}.` : `Reaberta: ${v.t.title}.`),
  );
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Tarefas</CardTitle>
          <CardDescription>Compromissos assumidos no grupo ou aprovados aqui</CardDescription>
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={onNew}>
            <Plus aria-hidden /> Nova
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {open.length === 0 && closed ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa ficou em aberto.</p>
        ) : open.length === 0 ? (
          <EmptyState icon={ListChecks} title="Nenhuma tarefa em aberto">
            Quando alguém disser no grupo “eu faço”, a tarefa aparece aqui.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {open.map((t) => {
              const overdue = !!t.dueDate && t.dueDate < today;
              return (
                <li key={t.id} className="flex min-h-14 items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {[t.assigneeName ?? 'Sem responsável', t.dueDate ? `até ${dayMonth(t.dueDate)}` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {overdue ? <Badge variant="late">! Atrasada</Badge> : null}
                  {canEdit ? (
                    <Button variant="outline" loading={update.isPending && update.variables?.t.id === t.id} onClick={() => update.mutate({ t, status: 'done' })}>
                      Concluir
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {done.length ? (
          <details className="mt-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground">
              {done.length} concluída{done.length > 1 ? 's' : ''}
            </summary>
            <ul className="grid gap-1 pb-1">
              {done.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground line-through">{t.title}</span>
                  <Badge variant={TASK_STATUS.done.variant}>{TASK_STATUS.done.label}</Badge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FinanceCard({ project: p, tz, canEdit }: { project: ProjectDetail; tz: string; canEdit: boolean }) {
  const items = p.expenses.filter((e) => e.status !== 'rejected' && e.status !== 'proposed');
  const pay = useProjectMutation(
    p.id,
    (e: ProjectExpense) => apiSend(`/projects/${p.id}/expenses/${e.id}/review`, 'POST', { action: 'mark_paid' }),
    (e) => `${e.description}: marcada como paga.`,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financeiro do projeto</CardTitle>
        <CardDescription>Cotação não é pagamento; “paga” exige comprovante ou validação</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lançamento validado ainda.</p>
        ) : (
          <ul className="divide-y">
            {items.map((e) => {
              const st = EXPENSE_STATUS[e.status];
              return (
                <li key={e.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {e.description}
                      {e.vendor ? <span className="font-normal text-muted-foreground"> · {e.vendor}</span> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {e.kind === 'quote' ? 'Cotação aprovada' : 'Despesa'}
                      {e.hasProof ? (
                        <>
                          {' · '}
                          <Paperclip size={13} aria-hidden className="inline align-[-2px]" /> comprovante
                        </>
                      ) : null}
                      {e.paidAt ? ` · paga em ${local(e.paidAt, tz).toFormat('dd/LL')}` : null}
                    </p>
                  </div>
                  <span className="tabular font-semibold">{e.amountCents === null ? '—' : formatBRL(e.amountCents)}</span>
                  <Badge variant={st.variant}>{st.label}</Badge>
                  {canEdit && e.status === 'confirmed' ? (
                    <Button variant="outline" loading={pay.isPending && pay.variables?.id === e.id} onClick={() => pay.mutate(e)}>
                      Marcar paga
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BriefingCard({ project: p }: { project: ProjectDetail }) {
  const b = p.briefing;
  const section = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</dt>
        <dd>
          <ul className="mt-1 grid gap-1">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </dd>
      </div>
    ) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Briefing</CardTitle>
        <CardDescription>Extraído do áudio de briefing enviado no grupo</CardDescription>
      </CardHeader>
      <CardContent>
        {!b ? (
          <p className="text-sm text-muted-foreground">Ainda sem briefing. Quem coordena o projeto pode mandar um áudio no grupo explicando objetivo, prazos e responsáveis.</p>
        ) : (
          <dl className="grid gap-4 text-sm">
            {section('Entregas', b.deliverables)}
            {section(
              'Prazos',
              b.deadlines.map((d) => (d.date ? `${dayMonth(d.date)} · ${d.description}` : d.description)),
            )}
            {section(
              'Responsáveis',
              b.owners.map((o) => (o.responsibility ? `${o.name} — ${o.responsibility}` : o.name)),
            )}
            {section('Ficou em aberto', b.openQuestions)}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsCard({ project: p }: { project: ProjectDetail }) {
  const patch = useProjectMutation(
    p.id,
    (groupCheckIns: boolean) => apiSend(`/projects/${p.id}`, 'PATCH', { groupCheckIns }),
    (on) => (on ? 'Check-in diário ligado.' : 'Check-in diário desligado.'),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>No grupo</CardTitle>
        <CardDescription>A Coxia só escreve quando há algo relevante</CardDescription>
      </CardHeader>
      <CardContent>
        <Checkbox label="Check-in diário de pendências no grupo" checked={p.groupCheckIns} onChange={(v) => patch.mutate(v)} />
        <p className="text-[13px] text-muted-foreground">No horário do briefing, só quando houver tarefa atrasada ou vencendo.</p>
      </CardContent>
    </Card>
  );
}

function CloseDialog({ project: p, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const open = p.tasks.filter((t) => t.status === 'open' || t.status === 'proposed').length;
  const unsettled = p.expenses.filter((e) => e.status === 'proposed' || e.status === 'confirmed').length;
  const close = useMutation({
    mutationFn: () => apiSend<{ report: string }>(`/projects/${p.id}/close`, 'POST'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success(`${p.title} encerrado. O relatório está na página do projeto.`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const pending = [
    open ? `${open} tarefa${open > 1 ? 's' : ''} em aberto` : null,
    unsettled ? `${unsettled} lançamento${unsettled > 1 ? 's' : ''} sem pagamento confirmado` : null,
    p.pendingReview ? `${p.pendingReview} ite${p.pendingReview > 1 ? 'ns' : 'm'} para revisar` : null,
  ].filter(Boolean);
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Encerrar ${p.title}?`}
      description="O histórico fica guardado e o grupo deixa de gerar tarefas e lançamentos."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="destructive" loading={close.isPending} onClick={() => close.mutate()}>
            Encerrar projeto
          </Button>
        </>
      }
    >
      {pending.length ? (
        <div className="rounded-md bg-muted p-4 text-sm">
          <p className="font-medium">Ainda há pendências:</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {pending.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma pendência em aberto.</p>
      )}
    </Dialog>
  );
}

function TaskDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useProjectMutation(
    projectId,
    (body: unknown) => apiSend(`/projects/${projectId}/tasks`, 'POST', body),
    () => 'Tarefa criada.',
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Informe a tarefa.');
    create.mutate({ title, assigneeName: assignee || null, dueDate: due || null }, { onSuccess: onClose });
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Nova tarefa"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="task-form" loading={create.isPending}>
            Criar
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Tarefa" error={error} className="sm:col-span-2">
          {(id, describedBy) => <Input id={id} value={title} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Fechar o cartaz" />}
        </Field>
        <Field label="Responsável">{(id) => <Input id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)} />}</Field>
        <Field label="Prazo">{(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
      </form>
    </Dialog>
  );
}
