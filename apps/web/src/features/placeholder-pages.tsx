import { Settings } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { ThemeSwitch } from '@/components/theme-switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/providers/auth-provider';

export function SettingsPage() {
  const { session } = useAuth();
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
            <CardTitle>Organização</CardTitle>
            <CardDescription>{session?.organization.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Fuso horário</dt>
              <dd className="font-mono text-[13px]">{session?.organization.timezone}</dd>
              <dt className="text-muted-foreground">Seu papel</dt>
              <dd>{session?.user.role}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
      <div className="mt-4">
        <EmptyState icon={Settings} title="Mais ajustes em breve">
          Salas, horários de funcionamento, contas e destinatários dos avisos serão editáveis aqui.
        </EmptyState>
      </div>
    </>
  );
}
