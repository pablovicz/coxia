import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import { ThemeSwitch } from '@/components/theme-switch';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export function LoginPage() {
  const { session, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await login(String(form.get('email')), String(form.get('password')));
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
          <div className="mb-6 grid size-12 place-items-center rounded-md bg-primary font-display text-2xl font-semibold text-primary-foreground">
            c.
          </div>
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">Boas-vindas à Coxia.</h1>
          <p className="mt-1 text-muted-foreground">A inteligência por trás da cena.</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!error} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!error} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={submitting} className="mt-2 w-full">
            Entrar
          </Button>
        </form>
        <p className="mt-8 text-center text-xs text-muted-foreground">Coxia · by Casa Kaju</p>
      </div>
    </div>
  );
}
