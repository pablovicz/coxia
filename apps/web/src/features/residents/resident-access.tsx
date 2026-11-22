import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@coxia/ui/components/ui/card';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field } from '@coxia/ui/components/ui/field';
import { Input, Skeleton } from '@coxia/ui/components/ui/input';
import { local } from '@coxia/ui/lib/format';
import { ApiBodyError, api, apiSend, RESIDENT_APP_URL, type ResidentAccess } from '@/lib/api';

const STATUS = {
  invited: { label: 'Convite enviado', badge: 'pending' },
  active: { label: 'Ativo', badge: 'active' },
  disabled: { label: 'Desativado', badge: 'archived' },
} as const;

/** Senha fácil de ditar: sem letras ou números que se confundem (l, 1, O, 0). */
export function generatePassword(length = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const APP_HOST = RESIDENT_APP_URL.replace(/^https?:\/\//, '');

export function accessMessage(email: string, password: string) {
  return `Seu acesso ao workspace da Casa Kaju: ${RESIDENT_APP_URL}\nE-mail: ${email}\nSenha provisória: ${password}\nNo primeiro acesso, você vai criar uma senha nova.`;
}

/** Depois de definir a senha provisória: a mensagem pronta para mandar ao residente. */
export function AccessShareDialog({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const message = accessMessage(email, password);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Mensagem copiada.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Senha provisória definida"
      description="Passe estes dados ao residente (por WhatsApp, por exemplo). No primeiro acesso ele cria uma senha nova."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" onClick={copy}>
            <Copy aria-hidden /> Copiar mensagem
          </Button>
          <Button onClick={onClose}>Pronto</Button>
        </div>
      }
    >
      <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-sm">{message}</pre>
    </Dialog>
  );
}

function ProvisionalPasswordDialog({ residentId, email, onClose }: { residentId: string; email: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState(() => generatePassword());
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiSend<ResidentAccess>(`/residents/${residentId}/access/password`, 'POST', { password }),
    onSuccess: () => {
      setSaved(password);
      void qc.invalidateQueries({ queryKey: ['resident-access', residentId] });
    },
    onError: (err) => setError(err instanceof ApiBodyError ? err.message : 'Não foi possível salvar.'),
  });
  const message = accessMessage(email, saved ?? password);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Mensagem copiada.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={saved ? 'Senha provisória definida' : 'Definir senha provisória'}
      description={saved ? 'Passe estes dados ao residente (por WhatsApp, por exemplo). No primeiro acesso ele cria uma senha nova.' : `O residente entra em ${APP_HOST} com ${email} e esta senha, e troca no primeiro acesso. Quem estiver logado precisa entrar de novo.`}
      footer={
        saved ? (
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={copy}>
              <Copy aria-hidden /> Copiar mensagem
            </Button>
            <Button onClick={onClose}>Pronto</Button>
          </div>
        ) : (
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                setError(null);
                if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
                save.mutate();
              }}
            >
              Definir senha
            </Button>
          </div>
        )
      }
    >
      {saved ? (
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-sm">{message}</pre>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Senha provisória" hint="Pelo menos 8 caracteres. Gere uma ou digite a sua.">
            {(id, d) => (
              <div className="flex gap-2">
                <Input id={id} value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} aria-describedby={d} />
                <Button type="button" variant="outline" size="icon" onClick={() => setPassword(generatePassword())} aria-label="Gerar outra senha">
                  <RefreshCw />
                </Button>
              </div>
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/** Acesso do residente ao workspace (residente.casakaju.com): convite por e-mail, senha provisória e desativação. */
export function ResidentAccessCard({ residentId, email, admin, tz }: { residentId: string; email: string | null; admin: boolean; tz: string }) {
  const qc = useQueryClient();
  const [provisional, setProvisional] = useState(false);
  const q = useQuery({ queryKey: ['resident-access', residentId], queryFn: () => api<ResidentAccess | null>(`/residents/${residentId}/access`) });
  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['resident-access', residentId] });
  };
  const fail = (err: unknown) => toast.error(err instanceof ApiBodyError ? err.message : 'Não foi possível agora.');
  const invite = useMutation({ mutationFn: () => apiSend<ResidentAccess>(`/residents/${residentId}/access/invite`, 'POST'), onSuccess: () => done(`Convite enviado para ${email}.`), onError: fail });
  const disable = useMutation({ mutationFn: () => apiSend(`/residents/${residentId}/access`, 'DELETE'), onSuccess: () => done('Acesso desativado.'), onError: fail });
  const a = q.data;

  let text: string;
  if (!a) text = `Sem acesso a ${APP_HOST} ainda.`;
  else if (a.status === 'disabled') text = 'O residente não entra mais no workspace.';
  else if (a.status === 'invited') text = `Convite para ${a.email}${a.invitedAt ? ` em ${local(a.invitedAt, tz).toFormat('dd/MM')}` : ''}; ainda não definiu a senha.`;
  else if (a.mustChangePassword) text = `Senha provisória definida para ${a.email}: o residente troca no primeiro acesso.`;
  else text = `Entra com ${a.email}${a.lastLoginAt ? ` · último acesso ${local(a.lastLoginAt, tz).toFormat('dd/MM HH:mm')}` : ''}.`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Workspace do residente</CardTitle>
        {a ? <Badge variant={a.status === 'active' && a.mustChangePassword ? 'pending' : STATUS[a.status].badge}>{a.status === 'active' && a.mustChangePassword ? 'Senha provisória' : STATUS[a.status].label}</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {q.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <p className="text-muted-foreground">{text}</p>
            {admin ? (
              email ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={a?.status === 'active' ? 'outline' : 'primary'} loading={invite.isPending} onClick={() => invite.mutate()}>
                    <KeyRound aria-hidden /> {a ? (a.status === 'active' ? 'Mandar link de nova senha' : 'Reenviar convite') : 'Enviar convite'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setProvisional(true)}>
                    Definir senha provisória
                  </Button>
                  {a && a.status !== 'disabled' ? (
                    <Button size="sm" variant="ghost" loading={disable.isPending} onClick={() => disable.mutate()}>
                      Desativar
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm">Cadastre o e-mail do residente (em “Editar”): é o login do workspace.</p>
              )
            ) : null}
          </>
        )}
      </CardContent>
      {provisional && email ? <ProvisionalPasswordDialog residentId={residentId} email={email} onClose={() => setProvisional(false)} /> : null}
    </Card>
  );
}
