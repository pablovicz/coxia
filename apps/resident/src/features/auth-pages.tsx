import { BrandMark } from '@coxia/ui/components/brand-mark';
import { Button } from '@coxia/ui/components/ui/button';
import { Card } from '@coxia/ui/components/ui/card';
import { Field } from '@coxia/ui/components/ui/field';
import { Input } from '@coxia/ui/components/ui/input';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiBodyError, ApiError, apiSend } from '@/lib/api';
import { useAuth } from '@/providers/auth';

function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark className="size-12" />
          <div className="leading-tight">
            <div className="font-display text-xl font-semibold">Casa Kaju</div>
            <div className="text-sm text-muted-foreground">Workspace do residente</div>
          </div>
        </div>
        <Card className="p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </main>
  );
}

/** Só caminhos internos (evita redirecionar para fora pelo ?next=). */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const { me, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to={next} replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(data.get('email')), String(data.get('password')));
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'E-mail ou senha incorretos.' : err instanceof ApiError && err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Não foi possível entrar agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Entrar" description={next.startsWith('/sala/') || next.includes('/check-in') ? 'Entre para fazer o check-in na sala.' : 'Reservas, saldo de horas e pagamentos.'}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="E-mail">{(id) => <Input id={id} name="email" type="email" autoComplete="email" required />}</Field>
        <Field label="Senha">{(id) => <Input id={id} name="password" type="password" autoComplete="current-password" required />}</Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy}>
          Entrar
        </Button>
        <Link to="/esqueci-senha" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Esqueci a senha
        </Link>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('/resident-auth/forgot', 'POST', { email: String(new FormData(e.currentTarget).get('email')) });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Confira o e-mail e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Esqueci a senha" description="Enviamos um link para você criar uma senha nova.">
      {sent ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Se este e-mail tiver acesso ao workspace, o link chega em alguns minutos. Ele vale por 1 hora.
          </p>
          <Button asChild variant="outline">
            <Link to="/entrar">Voltar para o login</Link>
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Field label="E-mail">{(id) => <Input id={id} name="email" type="email" autoComplete="email" required />}</Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={busy}>
            Enviar link
          </Button>
          <Link to="/entrar" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            Voltar
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

/** Primeiro acesso com a senha provisória da equipe: o residente cria a própria senha. */
export function ChangePasswordPage() {
  const { me, replaceToken, logout } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const currentPassword = String(data.get('current'));
    const newPassword = String(data.get('password'));
    if (newPassword.length < 8) return setError('A nova senha precisa ter pelo menos 8 caracteres.');
    if (newPassword !== String(data.get('confirm'))) return setError('As senhas não são iguais.');
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ accessToken: string }>('/resident-auth/change-password', 'POST', { currentPassword, newPassword });
      replaceToken(res.accessToken);
      await qc.invalidateQueries();
      toast.success('Senha criada. Bem-vindo ao workspace!');
    } catch (err) {
      setError(err instanceof ApiBodyError ? err.message : 'Não foi possível salvar agora.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Crie a sua senha" description={`Olá, ${me?.resident.name.split(' ')[0] ?? ''}! Você entrou com uma senha provisória. Para continuar, crie uma senha só sua.`}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Senha provisória">{(id) => <Input id={id} name="current" type="password" autoComplete="current-password" required />}</Field>
        <Field label="Nova senha" hint="Pelo menos 8 caracteres.">
          {(id, describedBy) => <Input id={id} name="password" type="password" autoComplete="new-password" aria-describedby={describedBy} required />}
        </Field>
        <Field label="Repita a nova senha">{(id) => <Input id={id} name="confirm" type="password" autoComplete="new-password" required />}</Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy}>
          Salvar e continuar
        </Button>
        <button type="button" onClick={logout} className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Sair
        </button>
      </form>
    </AuthLayout>
  );
}

export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password'));
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== String(data.get('confirm'))) return setError('As senhas não são iguais.');
    setBusy(true);
    setError(null);
    try {
      await apiSend('/resident-auth/password', 'POST', { token, password });
      navigate('/entrar', { replace: true, state: { passwordSet: true } });
    } catch (err) {
      setError(err instanceof ApiBodyError && err.code === 'invalid_token' ? 'Este link expirou ou já foi usado. Peça um novo em "Esqueci a senha".' : err instanceof ApiBodyError ? err.message : 'Não foi possível salvar agora.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Navigate to="/esqueci-senha" replace />;
  return (
    <AuthLayout title="Criar senha" description="Defina a senha do seu acesso ao workspace.">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Senha" hint="Pelo menos 8 caracteres.">
          {(id, describedBy) => <Input id={id} name="password" type="password" autoComplete="new-password" aria-describedby={describedBy} required />}
        </Field>
        <Field label="Repita a senha">{(id) => <Input id={id} name="confirm" type="password" autoComplete="new-password" required />}</Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy}>
          Salvar senha
        </Button>
      </form>
    </AuthLayout>
  );
}
