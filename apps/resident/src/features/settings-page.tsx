import { PageHeader } from '@coxia/ui/components/empty-state';
import { ThemeSwitch } from '@coxia/ui/components/theme-switch';
import { Button } from '@coxia/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@coxia/ui/components/ui/card';
import { Field } from '@coxia/ui/components/ui/field';
import { Input } from '@coxia/ui/components/ui/input';
import { PasswordInput } from '@coxia/ui/components/ui/password-input';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, LogOut, Trash2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ResidentAvatar } from '@/components/resident-avatar';
import { API_URL, ApiBodyError, apiSend, tokenStore } from '@/lib/api';
import { useAuth } from '@/providers/auth';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX = 5 * 1024 * 1024;

/** Configurações do residente: foto e e-mail de acesso. */
export function SettingsPage() {
  const { me, logout } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  if (!me) return null;

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return toast.error('A foto deve ser JPG, PNG ou WebP.');
    if (file.size > PHOTO_MAX) return toast.error('A foto deve ter até 5 MB.');
    setUploading(true);
    try {
      const token = tokenStore.get();
      const res = await fetch(`${API_URL}/me/photo`, { method: 'POST', headers: { 'content-type': file.type, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: file });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Não foi possível enviar a foto.');
      toast.success('Foto atualizada.');
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function removePhoto() {
    setRemoving(true);
    try {
      await apiSend('/me/photo', 'DELETE');
      toast.success('Foto removida.');
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch {
      toast.error('Não foi possível remover a foto.');
    } finally {
      setRemoving(false);
    }
  }

  async function changeEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email')).trim();
    const currentPassword = String(data.get('password'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setEmailError('Informe um e-mail válido.');
    if (!currentPassword) return setEmailError('Informe a sua senha atual.');
    setEmailBusy(true);
    setEmailError(null);
    try {
      const res = await apiSend<{ email: string }>('/me/email', 'POST', { email, currentPassword });
      toast.success(`Pronto: o seu acesso agora é ${res.email}.`);
      form.reset();
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setEmailError(err instanceof ApiBodyError ? err.message : 'Não foi possível trocar o e-mail.');
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Configurações" title="Minha conta" description="Foto e e-mail de acesso ao workspace." />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Foto</CardTitle>
            <CardDescription>Aparece no workspace e para a equipe da Casa Kaju.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            <ResidentAvatar name={me.resident.name} version={me.resident.photoUpdatedAt} className="size-20 text-xl" />
            <input ref={input} type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => upload(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" loading={uploading} onClick={() => input.current?.click()}>
                <Camera aria-hidden /> {me.resident.photoUpdatedAt ? 'Trocar foto' : 'Enviar foto'}
              </Button>
              {me.resident.photoUpdatedAt ? (
                <Button variant="ghost" loading={removing} onClick={removePhoto}>
                  <Trash2 aria-hidden /> Remover
                </Button>
              ) : null}
            </div>
            <p className="w-full text-xs text-muted-foreground">JPG, PNG ou WebP, até 5 MB.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>E-mail de acesso</CardTitle>
            <CardDescription>
              Você entra com <strong className="text-foreground">{me.resident.loginEmail}</strong>. Os convites das reservas também vão para este e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={changeEmail} noValidate>
              <Field label="Novo e-mail">{(id) => <Input id={id} name="email" type="email" autoComplete="email" required />}</Field>
              <Field label="Senha atual" hint="Para confirmar que é você.">
                {(id, d) => <PasswordInput id={id} name="password" autoComplete="current-password" aria-describedby={d} required />}
              </Field>
              {emailError ? (
                <p role="alert" className="text-sm text-destructive sm:col-span-2">
                  {emailError}
                </p>
              ) : null}
              <div className="sm:col-span-2">
                <Button type="submit" loading={emailBusy}>
                  Trocar e-mail
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aparência</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <ThemeSwitch />
            <Button variant="outline" onClick={logout}>
              <LogOut aria-hidden /> Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
