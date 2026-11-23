import { InstallAppButton } from '@coxia/ui/components/install-app-button';
import { BrandMark } from '@coxia/ui/components/brand-mark';
import { type FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { ThemeSwitch } from '@coxia/ui/components/theme-switch';
import { Button } from '@coxia/ui/components/ui/button';
import { Input, Label } from '@coxia/ui/components/ui/input';
import { PasswordInput } from '@coxia/ui/components/ui/password-input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

/** Último e-mail que entrou neste navegador (só o e-mail; a senha nunca é guardada). */
const LAST_EMAIL_KEY = 'coxia-last-email';
function lastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function LoginPage() {
  const { session, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remembered] = useState(lastEmail);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const email = String(form.get('email')).trim();
      await login(email, String(form.get('password')));
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email);
      } catch {
        /* sem storage: só não lembra */
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar agora. Tente de novo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeSwitch />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BrandMark className="mb-6 size-14" />
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">Boas-vindas à Coxia.</h1>
          <p className="mt-1 text-muted-foreground">A inteligência por trás da cena.</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="username" defaultValue={remembered} autoFocus={!remembered} required aria-invalid={!!error} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Senha</Label>
            <PasswordInput id="password" name="password" autoComplete="current-password" autoFocus={!!remembered} required aria-invalid={!!error} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={submitting} className="mt-2 w-full">
            Entrar
          </Button>
          <Link to="/esqueci-senha" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            Esqueci a senha
          </Link>
        </form>
        <InstallAppButton appName="Coxia" className="mt-6" />
        <p className="mt-8 text-center text-xs text-muted-foreground">Coxia · by Casa Kaju</p>
      </div>
    </div>
  );
}
