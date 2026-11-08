import { LogOut } from 'lucide-react';
import { PageHeader } from '@/components/empty-state';
import { ThemeSwitch } from '@/components/theme-switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { canManage } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { OpsPanel } from './ops-panel';
import { AccountPhone, ROLE_LABEL, TeamPanel } from './team-panel';


export function SettingsPage() {
  const { session, logout } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  return (
    <>
      <PageHeader eyebrow="Organização" title="Configurações." description="Preferências da casa e da sua conta." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aparência</CardTitle>
            <CardDescription>Claro, escuro ou seguindo o dispositivo</CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSwitch />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sua conta</CardTitle>
            <CardDescription>{session?.organization.name}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end justify-between gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Nome</dt>
              <dd>{session?.user.name}</dd>
              <dt className="text-muted-foreground">WhatsApp</dt>
              <dd>
                <AccountPhone />
              </dd>
              <dt className="text-muted-foreground">Papel</dt>
              <dd>{ROLE_LABEL[session?.user.role ?? ''] ?? session?.user.role}</dd>
              <dt className="text-muted-foreground">Fuso horário</dt>
              <dd className="font-mono text-[13px]">{tz}</dd>
            </dl>
            <Button variant="outline" onClick={logout}>
              <LogOut aria-hidden /> Sair
            </Button>
          </CardContent>
        </Card>
      </div>
      {canManage(session?.user.role) ? <TeamPanel /> : null}
      {canManage(session?.user.role) ? <OpsPanel tz={tz} /> : null}
    </>
  );
}
