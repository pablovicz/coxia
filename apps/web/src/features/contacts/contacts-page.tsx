import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Search, Users } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { Input, Skeleton, Textarea } from '@/components/ui/input';
import { api, apiSend, type Contact, type ContactGroupOption } from '@/lib/api';
import { formatPhone, local } from '@/lib/format';
import { ContactAvatar } from './contact-avatar';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

const PAGE = 50;
const ROLE_LABEL: Record<string, string> = { owner: 'Responsável', admin: 'Administração', staff: 'Equipe', viewer: 'Leitura' };

export const contactTitle = (c: Pick<Contact, 'name' | 'whatsappName' | 'phone'>) => c.name ?? c.whatsappName ?? formatPhone(c.phone);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Contatos: quem está nos grupos do WhatsApp da casa. Entram sozinhos (mensagens, entradas
 * e saídas dos grupos); aqui a equipe busca, identifica e dá nome a quem é quem.
 */
export function ContactsPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const [q, setQ] = useState('');
  const [groupId, setGroupId] = useState('');
  const [kind, setKind] = useState<'' | 'contact' | 'resident'>('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Contact | null>(null);
  const query = useDebounced(q.trim(), 250);

  const groups = useQuery({ queryKey: ['contacts', 'groups'], queryFn: () => api<ContactGroupOption[]>('/contacts/groups') });
  const params = new URLSearchParams({ limit: String(limit), ...(query ? { q: query } : {}), ...(groupId ? { groupId } : {}), ...(kind ? { kind } : {}) });
  const contacts = useQuery({
    queryKey: ['contacts', 'list', query, groupId, kind, limit],
    queryFn: () => api<{ items: Contact[]; total: number }>(`/contacts?${params}`),
    placeholderData: keepPreviousData,
  });
  // Nova busca ou outro grupo: volta para a primeira página.
  useEffect(() => setLimit(PAGE), [query, groupId, kind]);

  const data = contacts.data;
  const filtering = !!query || !!groupId || !!kind;

  return (
    <>
      <PageHeader
        eyebrow="Pessoas"
        title="Contatos."
        description="Quem está nos grupos do WhatsApp da casa. Entram sozinhos quando alguém é adicionado ou escreve."
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <label htmlFor="contacts-q" className="sr-only">
            Buscar por nome ou telefone
          </label>
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="contacts-q"
            type="search"
            className="pl-10"
            placeholder="Buscar por nome ou telefone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="sm:w-44">
          <label htmlFor="contacts-kind" className="sr-only">
            Tipo
          </label>
          <Select id="contacts-kind" value={kind} onChange={(e) => setKind(e.target.value as '' | 'contact' | 'resident')}>
            <option value="">Todos os tipos</option>
            <option value="resident">Residentes</option>
            <option value="contact">Contatos</option>
          </Select>
        </div>
        <div className="sm:w-72">
          <label htmlFor="contacts-group" className="sr-only">
            Grupo
          </label>
          <Select id="contacts-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Todos os grupos</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name ?? 'Grupo sem nome'} ({g.members})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {contacts.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Carregando contatos">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-18" />
          ))}
        </div>
      ) : contacts.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os contatos.
        </p>
      ) : data!.total === 0 ? (
        filtering ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum contato encontrado{query ? ` para “${query}”` : ''}{groupId ? ' neste grupo' : ''}.
          </p>
        ) : (
          <EmptyState icon={Users} title="Nenhum contato ainda">
            Assim que a Coxia estiver nos grupos do WhatsApp, quem participa deles aparece aqui.
          </EmptyState>
        )
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
            {data!.total === 1 ? '1 contato' : `${data!.total.toLocaleString('pt-BR')} contatos`}
          </p>
          <ul className={cn('flex flex-col gap-2', contacts.isFetching && 'opacity-70')}>
            {data!.items.map((c) => (
              <li key={c.id}>
                <ContactRow contact={c} tz={tz} onOpen={() => setOpen(c)} />
              </li>
            ))}
          </ul>
          {data!.items.length < data!.total ? (
            <div className="mt-4 flex justify-center">
              {limit < 200 ? (
                <Button variant="outline" loading={contacts.isFetching} onClick={() => setLimit((l) => Math.min(l + PAGE, 200))}>
                  Mostrar mais
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">Use a busca para achar os demais.</p>
              )}
            </div>
          ) : null}
        </>
      )}

      {open ? <ContactDialog id={open.id} preview={open} tz={tz} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ContactRow({ contact: c, tz, onOpen }: { contact: Contact; tz: string; onOpen: () => void }) {
  const title = contactTitle(c);
  const extra = c.groups.length - 2;
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`${title}, ${formatPhone(c.phone)}`}>
      <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-muted/40 sm:gap-4 sm:p-4">
        <ContactAvatar contact={c} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{title}</span>
            {c.kind === 'resident' ? (
              <Badge variant="info" className="shrink-0">
                Residente
              </Badge>
            ) : null}
            {c.member ? (
              <Badge variant="active" className="shrink-0">
                Equipe
              </Badge>
            ) : null}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {c.name || c.whatsappName ? <span className="tabular">{formatPhone(c.phone)}</span> : 'Sem nome no WhatsApp'}
            {c.name && c.whatsappName && c.whatsappName !== c.name ? ` · ${c.whatsappName} no WhatsApp` : ''}
          </span>
          {c.groups.length ? (
            <span className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
              {c.groups.slice(0, 2).map((g) => (
                <Badge key={g.group.id} variant="neutral" className="max-w-full truncate">
                  {g.group.name ?? 'Grupo sem nome'}
                </Badge>
              ))}
              {extra > 0 ? <Badge variant="neutral">+{extra}</Badge> : null}
            </span>
          ) : null}
        </span>
        {c.lastMessageAt ? (
          <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
            Última mensagem
            <br />
            {local(c.lastMessageAt, tz).toRelative({ locale: 'pt-BR' })}
          </span>
        ) : null}
      </Card>
    </button>
  );
}

function ContactDialog({ id, preview, tz, onClose }: { id: string; preview: Contact; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['contacts', 'detail', id], queryFn: () => api<Contact>(`/contacts/${id}`), placeholderData: preview });
  const c = detail.data ?? preview;
  const [name, setName] = useState(preview.name ?? '');
  const [notes, setNotes] = useState(preview.notes ?? '');
  const save = useMutation({
    mutationFn: () => apiSend<Contact>(`/contacts/${id}`, 'PATCH', { name: name.trim() || null, notes: notes.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contato atualizado.');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  const active = c.groups.filter((g) => !g.leftAt);
  const former = c.groups.filter((g) => g.leftAt);
  const formId = 'contact-form';
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={contactTitle(c)}
      description={formatPhone(c.phone)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden /> Abrir no WhatsApp
            </a>
          </Button>
          {c.member ? <Badge variant="active">Equipe · {ROLE_LABEL[c.member.role] ?? c.member.role}</Badge> : null}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Tipo</dt>
          <dd>{c.kind === 'resident' ? 'Residente (tem reserva recorrente)' : 'Contato'}</dd>
          <dt className="text-muted-foreground">No WhatsApp</dt>
          <dd>{c.whatsappName ?? '—'}</dd>
          <dt className="text-muted-foreground">Última mensagem</dt>
          <dd>{c.lastMessageAt ? local(c.lastMessageAt, tz).toFormat("dd/LL/yyyy 'às' HH:mm") : 'Ainda não escreveu'}</dd>
          <dt className="text-muted-foreground">Visto desde</dt>
          <dd>{local(c.createdAt, tz).toFormat('dd/LL/yyyy')}</dd>
        </dl>

        <section aria-labelledby="contact-groups">
          <h3 id="contact-groups" className="mb-2 text-sm font-medium">
            Grupos
          </h3>
          {active.length === 0 && former.length === 0 ? (
            <p className="text-sm text-muted-foreground">Só conversa direta com a Coxia.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {active.map((g) => (
                <li key={g.group.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {g.group.name ?? 'Grupo sem nome'}
                    {g.isAdmin ? <span className="text-muted-foreground"> · admin</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">desde {local(g.joinedAt, tz).toFormat('dd/LL/yy')}</span>
                </li>
              ))}
              {former.map((g) => (
                <li key={g.group.id} className="flex items-center justify-between gap-3 text-muted-foreground">
                  <span className="truncate line-through decoration-1">{g.group.name ?? 'Grupo sem nome'}</span>
                  <span className="shrink-0 text-xs">saiu em {local(g.leftAt!, tz).toFormat('dd/LL/yy')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form id={formId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Nome" hint="Como a equipe conhece a pessoa (o nome do WhatsApp continua salvo)">
            {(fid, describedBy) => (
              <Input id={fid} value={name} maxLength={120} placeholder={c.whatsappName ?? 'Nome'} aria-describedby={describedBy} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Observações">
            {(fid) => <Textarea id={fid} value={notes} maxLength={2000} rows={3} placeholder="Ex.: produtora da XPO, cuida da luz" onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </form>
      </div>
    </Dialog>
  );
}
