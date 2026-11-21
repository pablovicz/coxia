import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@coxia/ui/components/ui/badge';
import { Button } from '@coxia/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@coxia/ui/components/ui/card';
import { Skeleton } from '@coxia/ui/components/ui/input';
import { local } from '@coxia/ui/lib/format';
import { ApiBodyError, api, apiSend, RESIDENT_APP_URL, type ResidentAccess } from '@/lib/api';

const STATUS = {
  invited: { label: 'Convite enviado', badge: 'pending' },
  active: { label: 'Ativo', badge: 'active' },
  disabled: { label: 'Desativado', badge: 'archived' },
} as const;

/** Acesso do residente ao workspace (residente.casakaju.com): convite por e-mail e desativação. */
export function ResidentAccessCard({ residentId, email, admin, tz }: { residentId: string; email: string | null; admin: boolean; tz: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resident-access', residentId], queryFn: () => api<ResidentAccess | null>(`/residents/${residentId}/access`) });
  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['resident-access', residentId] });
  };
  const fail = (err: unknown) => toast.error(err instanceof ApiBodyError ? err.message : 'Não foi possível agora.');
  const invite = useMutation({ mutationFn: () => apiSend<ResidentAccess>(`/residents/${residentId}/access/invite`, 'POST'), onSuccess: () => done(`Convite enviado para ${email}.`), onError: fail });
  const disable = useMutation({ mutationFn: () => apiSend(`/residents/${residentId}/access`, 'DELETE'), onSuccess: () => done('Acesso desativado.'), onError: fail });
  const a = q.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Workspace do residente</CardTitle>
        {a ? <Badge variant={STATUS[a.status].badge}>{STATUS[a.status].label}</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {q.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <p className="text-muted-foreground">
              {a
                ? a.status === 'active'
                  ? `Entra com ${a.email}${a.lastLoginAt ? ` · último acesso ${local(a.lastLoginAt, tz).toFormat('dd/MM HH:mm')}` : ''}.`
                  : a.status === 'invited'
                    ? `Convite para ${a.email}${a.invitedAt ? ` em ${local(a.invitedAt, tz).toFormat('dd/MM')}` : ''}; ainda não definiu a senha.`
                    : 'O residente não entra mais no workspace.'
                : `Sem acesso a ${RESIDENT_APP_URL.replace(/^https?:\/\//, '')} ainda.`}
            </p>
            {admin ? (
              email ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={a?.status === 'active' ? 'outline' : 'primary'} loading={invite.isPending} onClick={() => invite.mutate()}>
                    <KeyRound aria-hidden /> {a ? (a.status === 'active' ? 'Mandar link de nova senha' : 'Reenviar convite') : 'Enviar convite'}
                  </Button>
                  {a && a.status !== 'disabled' ? (
                    <Button size="sm" variant="ghost" loading={disable.isPending} onClick={() => disable.mutate()}>
                      Desativar
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm">Cadastre o e-mail do residente (em “Editar”) para enviar o convite.</p>
              )
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
