import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Checkbox, Field } from '@coxia/ui/components/ui/field';
import { Input, Textarea } from '@coxia/ui/components/ui/input';
import { api, apiSend, type CreateProjectResult, type ProjectDetail, type ProjectGroupInfo } from '@/lib/api';
import { centsToInput, parseBRL } from '@coxia/ui/lib/format';
import { type PendingDocument, PendingDocuments, uploadPending } from './project-documents';

/** Mesmo corte do servidor: "PROJETO - XPO" digitado vira só "XPO". */
function bareTitle(title: string, prefix: string) {
  const t = title.trim();
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\-–—:|]*`, 'i');
  return t.replace(re, '').trim();
}

/**
 * Novo projeto pelo painel: nome (obrigatório), objetivo e orçamento. A Coxia cria o grupo
 * "PROJETO - Nome" com todas as administradoras; WhatsApp indisponível → projeto criado e o grupo
 * fica para "Criar no WhatsApp".
 */
/** Orçamento do site que vira projeto ("Promover a projeto"): o formulário já vem preenchido. */
export interface ProjectFromQuote {
  quoteRequestId: string;
  clientName: string;
  title: string;
  objective: string;
}

export function NewProjectDialog({ onClose, fromQuote }: { onClose: () => void; fromQuote?: ProjectFromQuote }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['projects', 'group-info'], queryFn: () => api<ProjectGroupInfo>('/projects/new/group-info') });
  const [title, setTitle] = useState(fromQuote?.title ?? '');
  const [objective, setObjective] = useState(fromQuote?.objective ?? '');
  const [budget, setBudget] = useState('');
  const [checkIns, setCheckIns] = useState(false);
  const [startsOn, setStartsOn] = useState('');
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const prefix = info.data?.prefix ?? 'PROJETO';
  const name = bareTitle(title, prefix);
  const withPhone = info.data?.admins.filter((a) => a.hasPhone) ?? [];
  const withoutPhone = info.data?.admins.filter((a) => !a.hasPhone) ?? [];
  const canCreateGroup = !!info.data?.whatsappConnected && withPhone.length > 0;

  const save = useMutation({
    mutationFn: async (body: unknown) => {
      const r = await apiSend<CreateProjectResult>('/projects', 'POST', body);
      // Documentos sobem depois (precisam do id do projeto); falha em um não desfaz o projeto.
      const docs = pending.length ? await uploadPending(r.project.id, pending) : { ok: 0, errors: [] as string[] };
      return { ...r, docs };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      if (fromQuote) qc.invalidateQueries({ queryKey: ['quote-requests'] });
      if (r.group.status === 'created') toast.success(`Projeto criado e grupo “${r.group.groupName}” criado no WhatsApp.`);
      else toast.warning(`Projeto criado. O grupo ficou para depois: ${r.group.reason}.`);
      if (r.docs.errors.length) toast.error(`Alguns documentos não subiram: ${r.docs.errors.join(' ')}`);
      onClose();
      navigate(`/projetos/${r.project.id}`);
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name) return setError('Informe o nome do projeto.');
    const cents = budget.trim() ? parseBRL(budget) : null;
    if (budget.trim() && cents === null) return setError('Orçamento inválido. Use, por exemplo, 8.000,00.');
    save.mutate({
      title: name,
      objective: objective.trim() || null,
      estimatedBudgetCents: cents,
      groupCheckIns: checkIns,
      startsOn: startsOn || null,
      ...(fromQuote ? { quoteRequestId: fromQuote.quoteRequestId } : {}),
    });
  }

  return (
    <Dialog
      open
      size="wide"
      onOpenChange={(v) => !v && onClose()}
      title={fromQuote ? 'Promover a projeto' : 'Novo projeto'}
      description={
        fromQuote
          ? `Orçamento de ${fromQuote.clientName}: os dados do pedido já vêm preenchidos. O projeto ganha um grupo no WhatsApp com a Coxia e todas as administradoras.`
          : 'O projeto ganha um grupo no WhatsApp com a Coxia e todas as administradoras.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="new-project" loading={save.isPending}>
            {canCreateGroup ? 'Criar projeto e grupo' : 'Criar projeto'}
          </Button>
        </>
      }
    >
      <form id="new-project" onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <Field label="Nome do projeto">{(id) => <Input id={id} value={title} maxLength={120} placeholder="Ex.: XPO" onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Objetivo (opcional)" hint="Também pode vir depois, pelo briefing em áudio no grupo">
            {(id, describedBy) => <Textarea id={id} rows={4} value={objective} maxLength={2000} aria-describedby={describedBy} onChange={(e) => setObjective(e.target.value)} />}
          </Field>
          <Field label="Orçamento estimado (R$, opcional)">
            {(id) => <Input id={id} inputMode="decimal" className="tabular" value={budget} placeholder="0,00" onChange={(e) => setBudget(e.target.value)} />}
          </Field>
          <Field label="Data de início (opcional)" hint="Com data no futuro, o projeto fica em “Aguardando” até começar">
            {(id, describedBy) => <Input id={id} type="date" className="sm:w-52" value={startsOn} aria-describedby={describedBy} onChange={(e) => setStartsOn(e.target.value)} />}
          </Field>
          <Checkbox label="Check-in diário de pendências no grupo" checked={checkIns} onChange={setCheckIns} />
          <PendingDocuments value={pending} onChange={setPending} onError={setError} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Grupo no WhatsApp</p>
            <p className="mt-1 flex items-center gap-2 font-semibold">
              <MessageCircle size={16} aria-hidden />
              <span className="truncate" aria-live="polite">
                {prefix} - {name || 'Nome'}
              </span>
            </p>
            <p className="mt-3 text-sm text-muted-foreground">Entram a Coxia e todas as administradoras:</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {(info.data?.admins ?? []).map((a) => (
                <li key={a.userId} className="flex items-center gap-2 text-sm">
                  <UserAvatar userId={a.userId} name={a.name} version={a.avatarUpdatedAt} className="size-7 text-[11px]" />
                  <span className={a.hasPhone ? '' : 'text-muted-foreground line-through'}>{a.name}</span>
                  {a.hasPhone ? null : <span className="text-xs text-destructive">sem telefone: não entra</span>}
                </li>
              ))}
            </ul>
          </div>
          {info.data && !info.data.whatsappConnected ? (
            <p role="status" className="flex gap-2 rounded-md border border-destructive/40 p-3 text-sm">
              <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-destructive" />
              <span>O WhatsApp da Coxia está desconectado. O projeto é criado agora e o grupo fica para depois, pelo botão “Criar no WhatsApp” no projeto.</span>
            </p>
          ) : info.data && withPhone.length === 0 ? (
            <p role="status" className="flex gap-2 rounded-md border border-destructive/40 p-3 text-sm">
              <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-destructive" />
              <span>Nenhuma administradora tem telefone cadastrado: cadastre em Configurações → Equipe para o grupo poder ser criado.</span>
            </p>
          ) : withoutPhone.length ? (
            <p className="text-sm text-muted-foreground">Quem está sem telefone entra depois, adicionada no WhatsApp.</p>
          ) : null}
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/** Projeto sem grupo (WhatsApp estava indisponível): cria agora. */
export function CreateWhatsappGroupCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => apiSend<{ groupName: string }>(`/projects/${projectId}/whatsapp-group`, 'POST'),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Grupo “${g.groupName}” criado no WhatsApp.`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        <span className="font-medium">Este projeto ainda não tem grupo no WhatsApp.</span>{' '}
        <span className="text-muted-foreground">A Coxia cria o grupo com todas as administradoras.</span>
      </p>
      <Button onClick={() => create.mutate()} loading={create.isPending}>
        <MessageCircle aria-hidden /> Criar no WhatsApp
      </Button>
    </div>
  );
}

/** Editar projeto: nome, objetivo, orçamento, check-in e mais documentos. */
export function EditProjectDialog({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(project.title);
  const [objective, setObjective] = useState(project.objective ?? '');
  const [budget, setBudget] = useState(project.estimatedBudgetCents != null ? centsToInput(project.estimatedBudgetCents) : '');
  const [checkIns, setCheckIns] = useState(project.groupCheckIns);
  const [startsOn, setStartsOn] = useState(project.startsOn ?? '');
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (body: unknown) => {
      await apiSend(`/projects/${project.id}`, 'PATCH', body);
      return pending.length ? uploadPending(project.id, pending) : { ok: 0, errors: [] as string[] };
    },
    onSuccess: (docs) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(docs.ok ? `Projeto atualizado; ${docs.ok === 1 ? '1 documento anexado' : `${docs.ok} documentos anexados`}.` : 'Projeto atualizado.');
      if (docs.errors.length) toast.error(`Alguns documentos não subiram: ${docs.errors.join(' ')}`);
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Informe o nome do projeto.');
    const cents = budget.trim() ? parseBRL(budget) : null;
    if (budget.trim() && cents === null) return setError('Orçamento inválido. Use, por exemplo, 8.000,00.');
    save.mutate({ title: title.trim(), objective: objective.trim() || null, estimatedBudgetCents: cents, groupCheckIns: checkIns, startsOn: startsOn || null });
  }
  return (
    <Dialog
      open
      size="wide"
      onOpenChange={(v) => !v && onClose()}
      title={`Editar ${project.title}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="edit-project" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="edit-project" onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <Field label="Nome do projeto">{(id) => <Input id={id} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Objetivo (opcional)">{(id) => <Textarea id={id} rows={4} value={objective} maxLength={2000} onChange={(e) => setObjective(e.target.value)} />}</Field>
          <Field label="Orçamento estimado (R$, opcional)">
            {(id) => <Input id={id} inputMode="decimal" className="tabular" value={budget} placeholder="0,00" onChange={(e) => setBudget(e.target.value)} />}
          </Field>
          <Field label="Data de início (opcional)" hint="Com data no futuro, o projeto fica em “Aguardando” até começar">
            {(id, describedBy) => <Input id={id} type="date" className="sm:w-52" value={startsOn} aria-describedby={describedBy} onChange={(e) => setStartsOn(e.target.value)} />}
          </Field>
          <Checkbox label="Check-in diário de pendências no grupo" checked={checkIns} onChange={setCheckIns} />
        </div>
        <div className="flex flex-col gap-4">
          <PendingDocuments value={pending} onChange={setPending} onError={setError} />
          <p className="text-sm text-muted-foreground">Os documentos já anexados ficam no quadro “Documentos” do projeto.</p>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
