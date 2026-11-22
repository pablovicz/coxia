import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, ImageIcon, RefreshCw, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field } from '@coxia/ui/components/ui/field';
import { Input, Textarea } from '@coxia/ui/components/ui/input';
import { apiSend, MAX_RESIDENT_FILE_BYTES, type Resident, RESIDENT_APP_URL, RESIDENT_FILE_TYPES, type ResidentStatus, uploadResidentFile } from '@/lib/api';
import { AccessShareDialog, generatePassword } from './resident-access';
import { formatPhone } from '@coxia/ui/lib/format';
import { cn } from '@coxia/ui/lib/utils';

function FilePick({
  label,
  hint,
  accept,
  file,
  current,
  onPick,
  icon: Icon,
}: {
  label: string;
  hint: string;
  accept: readonly string[];
  file: File | null;
  current: string | null;
  onPick: (f: File | null) => void;
  icon: typeof FileText;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id, describedBy) =>
        file ? (
          <div className="flex min-h-11 items-center justify-between gap-2 rounded-sm border bg-muted/40 pl-3">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Icon size={16} aria-hidden className="shrink-0" />
              <span className="truncate">{file.name}</span>
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label={`Tirar ${label.toLowerCase()}`} onClick={() => onPick(null)}>
              <X aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {current ? <p className="text-sm text-muted-foreground">Atual: {current}</p> : null}
            <Input
              id={id}
              type="file"
              accept={accept.join(',')}
              aria-describedby={describedBy}
              className="py-2 file:mr-3 file:rounded-sm file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>
        )
      }
    </Field>
  );
}

/**
 * Cadastro e edição do residente, em duas colunas: quem é e como falar com a pessoa (esquerda);
 * foto, contrato, status e dia de pagamento (direita).
 */
export function ResidentForm({ resident, onClose, onSaved }: { resident: Resident | null; onClose: () => void; onSaved?: (r: Resident) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(resident?.name ?? '');
  const [phone, setPhone] = useState(resident ? formatPhone(resident.contact.phone) : '');
  const [instagram, setInstagram] = useState(resident?.instagram ? `@${resident.instagram}` : '');
  const [email, setEmail] = useState(resident?.email ?? '');
  const [description, setDescription] = useState(resident?.description ?? '');
  const [status, setStatus] = useState<ResidentStatus>(resident?.status ?? 'active');
  const [paymentDay, setPaymentDay] = useState(resident?.paymentDay ? String(resident.paymentDay) : '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [contract, setContract] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Senha provisória (opcional): o residente entra no workspace e troca no primeiro acesso. */
  const [password, setPassword] = useState('');
  /** Depois de salvar com senha: mostra a mensagem para mandar ao residente. */
  const [shared, setShared] = useState<{ email: string; password: string } | null>(null);

  function pick(kind: 'photo' | 'contract', f: File | null) {
    setError(null);
    if (f && !(RESIDENT_FILE_TYPES[kind] as readonly string[]).includes(f.type)) {
      return setError(kind === 'photo' ? 'A foto deve ser JPG, PNG ou WebP.' : 'O contrato deve ser PDF ou foto.');
    }
    if (f && f.size > MAX_RESIDENT_FILE_BYTES) return setError('O arquivo deve ter até 10 MB.');
    (kind === 'photo' ? setPhoto : setContract)(f);
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        phone: phone.trim(),
        instagram: instagram.trim() || null,
        email: email.trim() || null,
        description: description.trim() || null,
        status,
        paymentDay: paymentDay.trim() ? Number(paymentDay) : null,
      };
      let saved = resident ? await apiSend<Resident>(`/residents/${resident.id}`, 'PATCH', body) : await apiSend<Resident>('/residents', 'POST', body);
      // Os arquivos vão depois do cadastro (precisam do id do residente).
      if (photo) saved = await uploadResidentFile(saved.id, 'photo', photo);
      if (contract) saved = await uploadResidentFile(saved.id, 'contract', contract);
      if (password) await apiSend(`/residents/${saved.id}/access/password`, 'POST', { password });
      return saved;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['residents'] });
      qc.invalidateQueries({ queryKey: ['resident'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['resident-access', r.id] });
      toast.success(resident ? 'Residente atualizado.' : 'Residente cadastrado.');
      onSaved?.(r);
      if (password) setShared({ email: r.email ?? email.trim(), password });
      else onClose();
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Informe o nome.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Informe o WhatsApp com DDD.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Informe o e-mail do residente (é o login do workspace).');
    if (password && password.length < 8) return setError('A senha provisória precisa ter pelo menos 8 caracteres.');
    const day = paymentDay.trim() ? Number(paymentDay) : null;
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) return setError('Dia de pagamento entre 1 e 31.');
    save.mutate();
  }

  // Salvou com senha provisória: troca o formulário pela mensagem para mandar ao residente.
  if (shared) return <AccessShareDialog email={shared.email} password={shared.password} onClose={onClose} />;

  return (
    <Dialog
      open
      size="wide"
      onOpenChange={(v) => !v && onClose()}
      title={resident ? `Editar ${resident.name}` : 'Novo residente'}
      description="O WhatsApp liga o residente às reservas e aos pagamentos dele."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="resident-form" loading={save.isPending}>
            {resident ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form id="resident-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={120} placeholder="Ex.: Coletivo Lume" onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="WhatsApp">{(id) => <Input id={id} inputMode="tel" value={phone} placeholder="11 98765-4321" onChange={(e) => setPhone(e.target.value)} />}</Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Instagram (opcional)">{(id) => <Input id={id} value={instagram} placeholder="@coletivolume" onChange={(e) => setInstagram(e.target.value)} />}</Field>
            <Field label="E-mail">{(id) => <Input id={id} type="email" required value={email} placeholder="contato@exemplo.com" onChange={(e) => setEmail(e.target.value)} />}</Field>
          </div>
          <Field label="Descrição (opcional)" hint="Para a página dos residentes, no futuro">
            {(id, describedBy) => (
              <Textarea id={id} rows={5} value={description} maxLength={4000} aria-describedby={describedBy} placeholder="Quem é, o que faz na casa…" onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="flex flex-col gap-4">
          <FilePick label="Foto (opcional)" hint="JPG, PNG ou WebP, até 10 MB. Sem foto, usa a do WhatsApp" accept={RESIDENT_FILE_TYPES.photo} file={photo} current={resident?.photoUpdatedAt ? 'foto enviada' : null} onPick={(f) => pick('photo', f)} icon={ImageIcon} />
          <FilePick label="Contrato (opcional)" hint="PDF ou foto, até 10 MB" accept={RESIDENT_FILE_TYPES.contract} file={contract} current={resident?.contractFileName ?? (resident?.contractUploadedAt ? 'contrato enviado' : null)} onPick={(f) => pick('contract', f)} icon={FileText} />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Status</legend>
            <div role="radiogroup" aria-label="Status" className="grid grid-cols-2 gap-1 rounded-md border bg-card p-1">
              {(
                [
                  ['active', 'Ativo'],
                  ['disabled', 'Desabilitado'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={status === v}
                  onClick={() => setStatus(v)}
                  className={cn('min-h-11 rounded-sm text-sm font-medium text-muted-foreground', status === v && 'bg-primary text-primary-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Dia de pagamento (opcional)" hint="Dia do mês combinado para pagar">
            {(id, describedBy) => <Input id={id} inputMode="numeric" className="tabular w-32" value={paymentDay} aria-describedby={describedBy} placeholder="Ex.: 5" onChange={(e) => setPaymentDay(e.target.value)} />}
          </Field>
          <Field
            label={resident ? 'Nova senha provisória (opcional)' : 'Senha provisória (opcional)'}
            hint={`Acesso ao workspace (${RESIDENT_APP_URL.replace(/^https?:\/\//, '')}) com o e-mail e esta senha; o residente troca no primeiro acesso.${resident ? ' Quem estiver logado precisa entrar de novo.' : ''}`}
          >
            {(id, describedBy) => (
              <div className="flex gap-2">
                <Input id={id} value={password} autoComplete="off" spellCheck={false} className="font-mono" aria-describedby={describedBy} placeholder="Deixe vazio para não criar agora" onChange={(e) => setPassword(e.target.value)} />
                <Button type="button" variant="outline" size="icon" onClick={() => setPassword(generatePassword())} aria-label="Gerar senha">
                  <RefreshCw />
                </Button>
              </div>
            )}
          </Field>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
