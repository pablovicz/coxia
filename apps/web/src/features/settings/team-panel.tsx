import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Phone, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, apiSend, type Role, type TeamMember } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

export const ROLE_LABEL: Record<string, string> = { owner: 'Responsável', admin: 'Administração', staff: 'Equipe', viewer: 'Leitura' };

/** Senha inicial legível (sem 0/O, 1/l), 12 caracteres. */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Telefone da própria conta: é por ele que a Coxia reconhece a pessoa no WhatsApp. */
export function AccountPhone() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(session?.user.phone ?? '');
  const save = useMutation({
    mutationFn: () => apiSend(`/organization/team/${session!.user.memberId}`, 'PATCH', { phone: phone.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth'] });
      qc.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Telefone salvo. A Coxia passa a reconhecer você por ele no WhatsApp.');
      setEditing(false);
    },
    onError: (e) => toast.error(e.message),
  });
  if (!session?.user.memberId) return null;
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className={session.user.phone ? 'tabular' : 'text-muted-foreground'}>{session.user.phone ? formatPhone(session.user.phone) : 'Não cadastrado'}</span>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Editar telefone">
          <Pencil aria-hidden /> <span className="hidden sm:inline">Editar</span>
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label htmlFor="account-phone" className="sr-only">
        Seu WhatsApp
      </label>
      <Input id="account-phone" inputMode="tel" className="w-48" value={phone} placeholder="11 98765-4321" onChange={(e) => setPhone(e.target.value)} />
      <Button type="submit" size="sm" loading={save.isPending}>
        Salvar
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancelar
      </Button>
    </form>
  );
}

/** Equipe: quem entra no painel e quem a Coxia reconhece no WhatsApp (pelo telefone). */
export function TeamPanel() {
  const team = useQuery({ queryKey: ['organization', 'team'], queryFn: () => api<TeamMember[]>('/organization/team') });
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);
  return (
    <section aria-labelledby="team-title" className="mt-8">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle id="team-title">Equipe</CardTitle>
            <CardDescription>O telefone identifica cada pessoa no WhatsApp: comandos, avisos e quem coordena projetos</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <UserPlus aria-hidden /> Adicionar
          </Button>
        </CardHeader>
        <CardContent>
          {team.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <ul className="divide-y">
              {(team.data ?? []).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{m.user.name}</span>
                      <Badge variant={m.role === 'owner' || m.role === 'admin' ? 'active' : 'neutral'} className="shrink-0">
                        {ROLE_LABEL[m.role]}
                      </Badge>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{m.user.email ?? '—'}</p>
                  </div>
                  <p className="flex items-center gap-1.5 text-sm">
                    <Phone size={14} aria-hidden className="text-muted-foreground" />
                    {m.user.phone ? <span className="tabular">{formatPhone(m.user.phone)}</span> : <span className="text-destructive">Sem telefone</span>}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(m)} aria-label={`Editar ${m.user.name}`}>
                    <Pencil aria-hidden /> <span className="hidden sm:inline">Editar</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {editing ? <MemberDialog member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function MemberDialog({ member, onClose }: { member: TeamMember | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [name, setName] = useState(member?.user.name ?? '');
  const [email, setEmail] = useState(member?.user.email ?? '');
  const [phone, setPhone] = useState(member?.user.phone ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'admin');
  const [projects, setProjects] = useState(member?.canManageProjects ?? true);
  const [briefing, setBriefing] = useState(member?.receivesMorningBriefing ?? false);
  const [password, setPassword] = useState(() => (member ? '' : generatePassword()));
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      member
        ? apiSend(`/organization/team/${member.id}`, 'PATCH', {
            name: name.trim(),
            phone: phone.trim() || null,
            role,
            canManageProjects: projects,
            receivesMorningBriefing: briefing,
          })
        : apiSend('/organization/team', 'POST', {
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim() || null,
            role,
            password,
            canManageProjects: projects,
            receivesMorningBriefing: briefing,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization'] });
      qc.invalidateQueries({ queryKey: ['auth'] });
      if (member) {
        toast.success('Dados salvos.');
        onClose();
      } else {
        setCreated({ email: email.trim(), password });
      }
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Informe o nome.');
    if (!member && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Informe um e-mail válido.');
    if (phone.trim() && phone.replace(/\D/g, '').length < 10) return setError('Telefone com DDD, ex.: 11 98765-4321.');
    if (!member && password.length < 8) return setError('A senha inicial precisa de pelo menos 8 caracteres.');
    save.mutate();
  }

  if (created) {
    return (
      <Dialog
        open
        onOpenChange={(v) => !v && onClose()}
        title="Pessoa cadastrada"
        description="Repasse o acesso por um canal seguro. A senha não aparece de novo."
        footer={<Button onClick={onClose}>Pronto</Button>}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">E-mail</dt>
          <dd>{created.email}</dd>
          <dt className="text-muted-foreground">Senha inicial</dt>
          <dd className="font-mono text-base">{created.password}</dd>
        </dl>
      </Dialog>
    );
  }

  const isOwner = session?.user.role === 'owner';
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={member ? `Editar ${member.user.name}` : 'Adicionar pessoa à equipe'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="member-form" loading={save.isPending}>
            {member ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Nome" className="sm:col-span-2">
          {(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {member ? null : (
          <Field label="E-mail (login)" className="sm:col-span-2">
            {(id) => <Input id={id} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
        )}
        <Field label="WhatsApp" hint="Identifica a pessoa no WhatsApp">
          {(id, describedBy) => <Input id={id} inputMode="tel" value={phone} placeholder="11 98765-4321" aria-describedby={describedBy} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <Field label="Papel">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(['owner', 'admin', 'staff', 'viewer'] as const)
                .filter((r) => r !== 'owner' || isOwner || member?.role === 'owner')
                .map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        {member ? null : (
          <Field label="Senha inicial" hint="Gerada automaticamente; pode trocar" className="sm:col-span-2">
            {(id, describedBy) => (
              <div className="flex gap-2">
                <Input id={id} className="font-mono" value={password} aria-describedby={describedBy} onChange={(e) => setPassword(e.target.value)} />
                <Button variant="outline" onClick={() => setPassword(generatePassword())}>
                  Gerar
                </Button>
              </div>
            )}
          </Field>
        )}
        <div className="sm:col-span-2">
          <Checkbox label="Coordena projetos (ativa e encerra grupos de projeto)" checked={projects} onChange={setProjects} />
          <Checkbox label="Recebe o briefing das 8h" checked={briefing} onChange={setBriefing} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
