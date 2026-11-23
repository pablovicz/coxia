import { BrandMark } from '@coxia/ui/components/brand-mark';
import { ThemeSwitch } from '@coxia/ui/components/theme-switch';
import { Button } from '@coxia/ui/components/ui/button';
import { Input, Label } from '@coxia/ui/components/ui/input';
import { PasswordInput } from '@coxia/ui/components/ui/password-input';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiBodyError, ApiError, apiSend } from '@/lib/api';

function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeSwitch />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BrandMark className="mb-6 size-14" />
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-muted-foreground">Coxia · by Casa Kaju</p>
      </div>
    </div>
  );
}

/** "Esqueci a senha": manda o link por e-mail (a resposta é sempre a mesma). */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email')).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Informe o seu e-mail.');
    setBusy(true);
    setError(null);
    try {
      await apiSend('/auth/forgot', 'POST', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Não foi possível agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Esqueci a senha." description="Mandamos um link para você criar uma senha nova.">
      {sent ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Se este e-mail tiver acesso à Coxia, o link chega em alguns minutos. Ele vale por 1 hora. Confira também a caixa de spam.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/entrar">Voltar para o login</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!error} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={busy} className="mt-2 w-full">
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

/** Senha nova pelo link do e-mail. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!token) return <Navigate to="/esqueci-senha" replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password'));
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== String(data.get('confirm'))) return setError('As senhas não são iguais.');
    setBusy(true);
    setError(null);
    try {
      await apiSend('/auth/password', 'POST', { token, password });
      toast.success('Senha redefinida. Entre com a senha nova.');
      navigate('/entrar', { replace: true });
    } catch (err) {
      setError(err instanceof ApiBodyError && err.body.details && (err.body.details as { code?: string }).code === 'invalid_token' ? 'Este link expirou ou já foi usado. Peça um novo.' : err instanceof ApiBodyError ? err.body.message : 'Não foi possível salvar agora.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Senha nova." description="Escolha a sua senha nova da Coxia.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha nova</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required aria-describedby="password-hint" />
          <p id="password-hint" className="text-xs text-muted-foreground">
            Pelo menos 8 caracteres.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">Repita a senha</Label>
          <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}{' '}
            {error.includes('Peça um novo') ? (
              <Link to="/esqueci-senha" className="underline underline-offset-4">
                Pedir outro link
              </Link>
            ) : null}
          </p>
        ) : null}
        <Button type="submit" loading={busy} className="mt-2 w-full">
          Salvar senha
        </Button>
      </form>
    </AuthLayout>
  );
}
