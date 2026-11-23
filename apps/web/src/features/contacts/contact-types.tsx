import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Select } from '@coxia/ui/components/ui/field';
import { Input } from '@coxia/ui/components/ui/input';
import { ApiBodyError, api, apiSend, type ContactType } from '@/lib/api';

export function useContactTypes() {
  return useQuery({ queryKey: ['contact-types'], queryFn: () => api<ContactType[]>('/contact-types') });
}

const errorOf = (err: unknown) => (err instanceof ApiBodyError ? err.message : 'Não foi possível salvar.');

function TypeRow({ type, onChanged }: { type: ContactType; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);
  const [confirming, setConfirming] = useState(false);
  const rename = useMutation({
    mutationFn: () => apiSend(`/contact-types/${type.id}`, 'PATCH', { name: name.trim() }),
    onSuccess: () => (setEditing(false), onChanged()),
    onError: (e) => toast.error(errorOf(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiSend(`/contact-types/${type.id}`, 'DELETE'),
    onSuccess: () => (toast.success(`Tipo “${type.name}” apagado.`), onChanged()),
    onError: (e) => toast.error(errorOf(e)),
  });
  return (
    <li className="flex min-h-12 items-center gap-2 py-1.5">
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) rename.mutate();
          }}
        >
          <Input aria-label="Nome do tipo" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="icon" variant="ghost" loading={rename.isPending} aria-label="Salvar">
            <Check />
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={() => (setEditing(false), setName(type.name))} aria-label="Cancelar">
            <X />
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-medium">{type.name}</span>
          <span className="tabular shrink-0 text-sm text-muted-foreground">{type.contacts === 1 ? '1 contato' : `${type.contacts} contatos`}</span>
          <Button size="icon" variant="ghost" onClick={() => setEditing(true)} aria-label={`Renomear ${type.name}`}>
            <Pencil />
          </Button>
          {confirming ? (
            <Button size="sm" variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()} onBlur={() => !remove.isPending && setConfirming(false)} autoFocus>
              Apagar
            </Button>
          ) : (
            <Button size="icon" variant="ghost" onClick={() => setConfirming(true)} aria-label={`Apagar ${type.name}`}>
              <Trash2 />
            </Button>
          )}
        </>
      )}
    </li>
  );
}

/**
 * Tipos de contato da casa (Costureiras, Pintores, Encanadores…). Residente e Lead são automáticos:
 * não aparecem aqui. Apagar um tipo não apaga os contatos (eles ficam sem tipo).
 */
export function ContactTypesDialog({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const types = useContactTypes();
  const [name, setName] = useState('');
  const changed = () => {
    void qc.invalidateQueries({ queryKey: ['contact-types'] });
    void qc.invalidateQueries({ queryKey: ['contacts'] });
  };
  const create = useMutation({
    mutationFn: () => apiSend('/contact-types', 'POST', { name: name.trim() }),
    onSuccess: () => (setName(''), changed()),
    onError: (e) => toast.error(errorOf(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  const list = types.data ?? [];
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Tipos de contato"
      description="Organize os contatos por tipo (ex.: Costureiras, Pintores). Residente e Lead (pediu orçamento) são marcados sozinhos."
      footer={<Button onClick={onClose}>Pronto</Button>}
    >
      <div className="flex flex-col gap-4">
        {admin ? (
          <form className="flex gap-2" onSubmit={submit}>
            <Input aria-label="Novo tipo" value={name} maxLength={60} placeholder="Ex.: Costureiras" onChange={(e) => setName(e.target.value)} />
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              <Plus aria-hidden /> Adicionar
            </Button>
          </form>
        ) : null}
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum tipo cadastrado ainda.</p>
        ) : (
          <ul className="divide-y">
            {list.map((t) =>
              admin ? (
                <TypeRow key={t.id} type={t} onChanged={changed} />
              ) : (
                <li key={t.id} className="flex min-h-12 items-center justify-between py-1.5">
                  <span className="font-medium">{t.name}</span>
                  <span className="tabular text-sm text-muted-foreground">{t.contacts}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/** Seletor do tipo do contato (cadastrados). */
export function ContactTypeSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const types = useContactTypes();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sem tipo</option>
      {(types.data ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  );
}
