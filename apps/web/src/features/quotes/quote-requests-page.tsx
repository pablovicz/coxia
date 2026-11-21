import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Inbox, Mail, MessageCircle, Rocket } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@coxia/ui/components/empty-state';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field } from '@coxia/ui/components/ui/field';
import { Skeleton, Textarea } from '@coxia/ui/components/ui/input';
import { NewProjectDialog, type ProjectFromQuote } from '@/features/projects/new-project-dialog';
import {
  api,
  apiSend,
  canManage,
  QUOTE_SEGMENTS,
  QUOTE_SERVICES,
  QUOTE_STATUS,
  type QuoteRequest,
  type QuoteRequestList,
  type QuoteRequestStatus,
} from '@/lib/api';
import { formatPhone, local } from '@coxia/ui/lib/format';
import { cn } from '@coxia/ui/lib/utils';
import { useAuth } from '@/providers/auth-provider';

const STATUSES = Object.keys(QUOTE_STATUS) as QuoteRequestStatus[];
export const quoteServices = (q: Pick<QuoteRequest, 'services'>) => q.services.map((s) => QUOTE_SERVICES[s] ?? s).join(', ');
const dateBr = (iso: string) => DateTime.fromISO(iso).toFormat('dd/LL/yyyy');
export const whatsappLink = (q: Pick<QuoteRequest, 'phone' | 'name'>) =>
  `https://wa.me/${q.phone}?text=${encodeURIComponent(`Olá, ${q.name.split(' ')[0]}! Aqui é da Casa Kaju, sobre o seu pedido de orçamento.`)}`;

/**
 * Orçamentos pedidos pelo site casakaju.com. As administradoras recebem o aviso no WhatsApp e
 * conversam direto com o cliente; aprovado, o orçamento vira projeto ("Promover a projeto").
 */
export function QuoteRequestsPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const admin = canManage(session?.user.role);
  const [params, setParams] = useSearchParams();
  const tab: QuoteRequestStatus = STATUSES.includes(params.get('situacao') as QuoteRequestStatus) ? (params.get('situacao') as QuoteRequestStatus) : 'new';
  const [openId, setOpenId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<ProjectFromQuote | null>(null);
  const list = useQuery({ queryKey: ['quote-requests'], queryFn: () => api<QuoteRequestList>('/quote-requests') });
  const items = (list.data?.items ?? []).filter((q) => q.status === tab);
  const open = list.data?.items.find((q) => q.id === openId) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Site casakaju.com"
        title="Orçamentos."
        description="Pedidos feitos no site. As administradoras recebem cada um no WhatsApp; aprovado, o orçamento vira projeto."
      />

      {list.isPending ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Carregando orçamentos">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os orçamentos.
        </p>
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={Inbox} title="Nenhum orçamento ainda">
          Quando alguém preencher “Solicite um orçamento” no site, o pedido aparece aqui e as administradoras recebem o aviso no WhatsApp.
        </EmptyState>
      ) : (
        <>
          <div role="tablist" aria-label="Situação dos orçamentos" className="mb-4 grid grid-cols-2 gap-1 rounded-md border bg-card p-1 sm:inline-grid sm:w-auto sm:grid-cols-4">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                id={`tab-${s}`}
                aria-selected={tab === s}
                aria-controls="panel-orcamentos"
                onClick={() => setParams(s === 'new' ? {} : { situacao: s }, { replace: true })}
                className={cn('min-h-11 rounded-sm px-3 text-sm font-medium text-muted-foreground sm:px-4 lg:min-h-9', tab === s && 'bg-primary text-primary-foreground')}
              >
                {QUOTE_STATUS[s].tab} <span className="tabular opacity-80">({list.data.counts[s]})</span>
              </button>
            ))}
          </div>

          <div id="panel-orcamentos" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum orçamento em “{QUOTE_STATUS[tab].tab}”.</p>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2" aria-label={`Orçamentos: ${QUOTE_STATUS[tab].tab}`}>
                {items.map((q) => (
                  <li key={q.id}>
                    <button type="button" onClick={() => setOpenId(q.id)} className="group block w-full rounded-lg text-left">
                      <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary/40">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 truncate font-semibold">{q.name}</p>
                          <span className="shrink-0 text-xs text-muted-foreground">{local(q.createdAt, tz).toFormat('dd/LL HH:mm')}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {QUOTE_SEGMENTS[q.segment] ?? q.segment} · {q.space ? q.space.name : quoteServices(q)}
                          {q.neededBy ? ` · para ${dateBr(q.neededBy)}` : ''}
                        </p>
                        <p className="line-clamp-2 text-sm">{q.description}</p>
                        {q.project ? (
                          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                            <FolderKanban size={15} aria-hidden /> Projeto: {q.project.title}
                          </p>
                        ) : null}
                      </Card>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {open ? (
        <QuoteRequestDialog
          request={open}
          tz={tz}
          admin={admin}
          onClose={() => setOpenId(null)}
          onPromote={() => {
            setPromoting({ quoteRequestId: open.id, clientName: open.name, ...open.projectDraft });
            setOpenId(null);
          }}
        />
      ) : null}
      {promoting ? <NewProjectDialog fromQuote={promoting} onClose={() => setPromoting(null)} /> : null}
    </>
  );
}

function QuoteRequestDialog({
  request: q,
  tz,
  admin,
  onClose,
  onPromote,
}: {
  request: QuoteRequest;
  tz: string;
  admin: boolean;
  onClose: () => void;
  onPromote: () => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(q.notes ?? '');
  const save = useMutation({
    mutationFn: (patch: { status?: QuoteRequestStatus; notes?: string | null }) => apiSend<QuoteRequest>(`/quote-requests/${q.id}`, 'PATCH', patch),
    onSuccess: (_d, patch) => {
      qc.invalidateQueries({ queryKey: ['quote-requests'] });
      toast.success(patch.status ? `Orçamento movido para “${QUOTE_STATUS[patch.status].tab}”.` : 'Anotações salvas.');
      if (patch.status) onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  // "Aprovado" só pelo "Promover a projeto"; depois de virar projeto, a situação não muda mais.
  const moves = q.project ? [] : STATUSES.filter((s) => s !== q.status && s !== 'approved');
  const moveLabel: Record<QuoteRequestStatus, string> = { new: 'Voltar para novos', contacted: 'Em conversa', approved: '', archived: 'Arquivar' };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      size="wide"
      title={q.name}
      description={`Orçamento pedido em ${local(q.createdAt, tz).toFormat("dd/LL/yyyy 'às' HH:mm")} pelo site`}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {moves.map((s) => (
            <Button key={s} variant="outline" loading={save.isPending && save.variables?.status === s} onClick={() => save.mutate({ status: s })}>
              {moveLabel[s]}
            </Button>
          ))}
          {q.project ? (
            <Button asChild>
              <Link to={`/projetos/${q.project.id}`}>
                <FolderKanban aria-hidden /> Abrir projeto
              </Link>
            </Button>
          ) : admin ? (
            <Button onClick={onPromote}>
              <Rocket aria-hidden /> Promover a projeto
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Situação</dt>
          <dd>
            <Badge variant={QUOTE_STATUS[q.status].variant}>{QUOTE_STATUS[q.status].label}</Badge>
          </dd>
          <dt className="text-muted-foreground">WhatsApp</dt>
          <dd>{formatPhone(q.phone)}</dd>
          <dt className="text-muted-foreground">E-mail</dt>
          <dd className="break-all">{q.email}</dd>
          <dt className="text-muted-foreground">Segmento</dt>
          <dd>{QUOTE_SEGMENTS[q.segment] ?? q.segment}</dd>
          <dt className="text-muted-foreground">Serviços</dt>
          <dd>{quoteServices(q)}</dd>
          {q.space ? (
            <>
              <dt className="text-muted-foreground">Espaço</dt>
              <dd>{q.space.name}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Para quando</dt>
          <dd>{q.neededBy ? dateBr(q.neededBy) : 'Não informado'}</dd>
          {q.project ? (
            <>
              <dt className="text-muted-foreground">Projeto</dt>
              <dd>
                <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/projetos/${q.project.id}`}>
                  {q.project.title}
                </Link>
              </dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-sm font-medium">Sobre o projeto</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{q.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.open(whatsappLink(q), '_blank', 'noopener')}>
              <MessageCircle aria-hidden /> Responder no WhatsApp
            </Button>
            <Button variant="outline" onClick={() => (window.location.href = `mailto:${q.email}?subject=${encodeURIComponent('Seu pedido de orçamento - Casa Kaju')}`)}>
              <Mail aria-hidden /> E-mail
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:col-span-2">
          <Field label="Anotações da equipe" hint="Valor combinado, próximos passos, quem está cuidando">
            {(id, describedBy) => <Textarea id={id} rows={3} maxLength={4000} value={notes} aria-describedby={describedBy} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <Button
            variant="outline"
            className="self-start"
            disabled={(q.notes ?? '') === notes.trim()}
            loading={save.isPending && save.variables?.notes !== undefined}
            onClick={() => save.mutate({ notes: notes.trim() || null })}
          >
            Salvar anotações
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
