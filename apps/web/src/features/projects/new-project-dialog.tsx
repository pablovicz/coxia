import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { api, apiSend, type CreateProjectResult, type ProjectGroupInfo } from '@/lib/api';
import { parseBRL } from '@/lib/format';

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
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['projects', 'group-info'], queryFn: () => api<ProjectGroupInfo>('/projects/new/group-info') });
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [checkIns, setCheckIns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefix = info.data?.prefix ?? 'PROJETO';
  const name = bareTitle(title, prefix);
  const withPhone = info.data?.admins.filter((a) => a.hasPhone) ?? [];
  const withoutPhone = info.data?.admins.filter((a) => !a.hasPhone) ?? [];
  const canCreateGroup = !!info.data?.whatsappConnected && withPhone.length > 0;

  const save = useMutation({
    mutationFn: (body: unknown) => apiSend<CreateProjectResult>('/projects', 'POST', body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      if (r.group.status === 'created') toast.success(`Projeto criado e grupo “${r.group.groupName}” criado no WhatsApp.`);
      else toast.warning(`Projeto criado. O grupo ficou para depois: ${r.group.reason}.`);
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
    save.mutate({ title: name, objective: objective.trim() || null, estimatedBudgetCents: cents, groupCheckIns: checkIns });
  }

  return (
    <Dialog
      open
      size="wide"
      onOpenChange={(v) => !v && onClose()}
      title="Novo projeto"
      description="O projeto ganha um grupo no WhatsApp com a Coxia e todas as administradoras."
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
          <Checkbox label="Check-in diário de pendências no grupo" checked={checkIns} onChange={setCheckIns} />
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
