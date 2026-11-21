import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, MessageCircle, Phone, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MemberCheckbox } from '@/components/member-checkbox';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field, Select } from '@coxia/ui/components/ui/field';
import { Input, Textarea } from '@coxia/ui/components/ui/input';
import { api, apiSend, type Contact, type Member, type ReminderType } from '@/lib/api';
import { ContactPicker } from '@/features/contacts/contact-picker';
import { ProjectPicker } from '@/features/projects/project-picker';
import { formatPhone, toZonedIso } from '@coxia/ui/lib/format';
import { cn } from '@coxia/ui/lib/utils';
import { useAuth } from '@/providers/auth-provider';

export const REMINDER_TYPES: Record<ReminderType, { label: string; Icon: typeof Bell }> = {
  general: { label: 'Lembrete', Icon: Bell },
  call: { label: 'Ligar', Icon: Phone },
  message: { label: 'Mensagem', Icon: MessageCircle },
};

/** "dias úteis", "toda semana", "todo mês"… a partir da RRULE. */
export function repeatLabel(rule: string | null): string | null {
  if (!rule) return null;
  if (rule.startsWith('FREQ=MONTHLY')) return 'todo mês';
  const days = /BYDAY=([A-Z,]+)/.exec(rule)?.[1]?.split(',') ?? [];
  if (days.length === 7) return 'todo dia';
  if (days.length === 5 && !days.includes('SA') && !days.includes('SU')) return 'dias úteis';
  return 'toda semana';
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
const REPEAT: Record<Repeat, string> = {
  none: 'Não repete',
  daily: 'Todo dia',
  weekdays: 'Dias úteis (seg a sex)',
  weekly: 'Toda semana neste dia',
  monthly: 'Todo mês neste dia',
};

function ruleFor(repeat: Repeat, date: string): string | null {
  const d = DateTime.fromISO(date);
  switch (repeat) {
    case 'none':
      return null;
    case 'daily':
      return `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES.join(',')}`;
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[d.weekday - 1]}`;
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${d.day}`;
  }
}

/** Próxima hora cheia no fuso da casa (depois das 21h, amanhã às 9h). */
function nextSlot(tz: string) {
  const now = DateTime.now().setZone(tz);
  const slot = now.hour >= 21 ? now.plus({ days: 1 }).set({ hour: 9, minute: 0 }) : now.plus({ hours: 1 }).startOf('hour');
  return { date: slot.toISODate()!, time: slot.toFormat('HH:mm') };
}

/**
 * Novo lembrete: geral ("Renovar o alvará"), ligar ou mandar mensagem para alguém
 * ("Ligar para a Carla às 14h"). O aviso chega pelo WhatsApp para quem for marcado.
 */
export function ReminderForm({ tz, onClose, defaultDate }: { tz: string; onClose: () => void; defaultDate?: string }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const next = nextSlot(tz);
  // Aberto a partir de um dia do calendário: esse dia, às 9h (se não for hoje).
  const slot = defaultDate && defaultDate !== next.date ? { date: defaultDate, time: '09:00' } : next;
  const [type, setType] = useState<ReminderType>('general');
  const [title, setTitle] = useState('');
  const [contact, setContact] = useState<Contact | null>(null);
  const [manual, setManual] = useState(false);
  const [personName, setPersonName] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [date, setDate] = useState(slot.date);
  const [time, setTime] = useState(slot.time);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [message, setMessage] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: () => api<Member[]>('/organization/members') });
  // Quem cria recebe o aviso, se tiver WhatsApp cadastrado.
  useEffect(() => {
    const me = members.data?.find((m) => m.userId === session?.user.id);
    if (me?.phone) setRecipients((r) => (r.length ? r : [me.phone!]));
  }, [members.data, session?.user.id]);

  const needsPerson = type !== 'general';
  const who = contact ? (contact.name ?? contact.whatsappName ?? formatPhone(contact.phone)) : personName.trim() || (personPhone.trim() ? personPhone.trim() : '');
  const autoTitle = type === 'call' ? `Ligar para ${who || '…'}` : type === 'message' ? `Mandar mensagem para ${who || '…'}` : '';

  const create = useMutation({
    mutationFn: (body: unknown) => apiSend('/reminders', 'POST', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      toast.success('Lembrete criado. O aviso chega pelo WhatsApp no horário marcado.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const extraPhones = extra.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
    const to = [...recipients, ...extraPhones];
    if (needsPerson && !contact && !personName.trim() && !personPhone.trim()) {
      return setError(type === 'call' ? 'Para quem é a ligação? Escolha um contato ou digite o nome.' : 'Para quem é a mensagem? Escolha um contato ou digite o nome.');
    }
    if (!needsPerson && !title.trim()) return setError('Informe o que lembrar.');
    if (!date || !time) return setError('Informe data e hora.');
    if (to.length === 0) return setError('Marque quem recebe o aviso.');
    const dueAt = toZonedIso(date, time, tz);
    if (repeat === 'none' && new Date(dueAt) < new Date()) return setError('Esse horário já passou.');
    create.mutate({
      type,
      title: title.trim() || null,
      message: message.trim() || null,
      dueAt,
      recurrenceRule: ruleFor(repeat, date),
      recipientPhones: to,
      contactId: contact?.id ?? null,
      personName: contact ? null : personName.trim() || null,
      personPhone: contact ? null : personPhone.trim() || null,
      projectId,
    });
  }

  const formId = 'reminder-form';
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Novo lembrete"
      description="O aviso chega pelo WhatsApp de quem for marcado, no horário escolhido."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            Criar lembrete
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div role="radiogroup" aria-label="Tipo de lembrete" className="grid grid-cols-3 gap-1 rounded-md border bg-card p-1">
          {(Object.keys(REMINDER_TYPES) as ReminderType[]).map((t) => {
            const { label, Icon } = REMINDER_TYPES[t];
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm text-sm font-medium text-muted-foreground',
                  type === t && 'bg-primary text-primary-foreground',
                )}
              >
                <Icon size={16} aria-hidden /> {label}
              </button>
            );
          })}
        </div>

        {needsPerson ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{type === 'call' ? 'Ligar para' : 'Mandar mensagem para'}</legend>
            {contact ? (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{who}</p>
                  <p className="tabular text-sm text-muted-foreground">{formatPhone(contact.phone)}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Trocar pessoa" onClick={() => setContact(null)}>
                  <X aria-hidden />
                </Button>
              </div>
            ) : manual ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome">{(id) => <Input id={id} value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Ex.: Seu Zé do som" />}</Field>
                <Field label="Telefone (opcional)">
                  {(id) => <Input id={id} inputMode="tel" value={personPhone} onChange={(e) => setPersonPhone(e.target.value)} placeholder="55 11 90000-0000" />}
                </Field>
                <button type="button" className="min-h-11 text-left text-sm font-medium text-primary underline-offset-4 hover:underline sm:col-span-2" onClick={() => setManual(false)}>
                  Buscar nos contatos
                </button>
              </div>
            ) : (
              <>
                <ContactPicker onPick={setContact} />
                <button type="button" className="min-h-11 self-start text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setManual(true)}>
                  Não está nos contatos? Digitar nome e telefone
                </button>
              </>
            )}
          </fieldset>
        ) : null}

        <Field label={needsPerson ? 'Título (opcional)' : 'O que lembrar'}>
          {(id) => (
            <Input
              id={id}
              value={title}
              maxLength={120}
              placeholder={needsPerson ? autoTitle : 'Ex.: Renovar o alvará'}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Hora">{(id) => <Input id={id} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        <Field label="Repetir">
          {(id) => (
            <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {(Object.keys(REPEAT) as Repeat[]).map((r) => (
                <option key={r} value={r}>
                  {REPEAT[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <ProjectPicker label="Projeto (opcional)" value={projectId} onChange={setProjectId} />

        <Field label="Observação (opcional)">
          {(id) => <Textarea id={id} rows={2} value={message} maxLength={1000} placeholder="Ex.: confirmar a mesa de som para sexta" onChange={(e) => setMessage(e.target.value)} />}
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Quem recebe o aviso</legend>
          {(members.data ?? []).flatMap((m) => {
            const phone = m.phone;
            if (!phone) return [];
            return [
              <MemberCheckbox
                key={m.userId}
                userId={m.userId}
                name={m.name}
                avatarUpdatedAt={m.avatarUpdatedAt}
                label={`${m.name} · ${formatPhone(phone)}`}
                checked={recipients.includes(phone)}
                onChange={(on) => setRecipients((r) => (on ? [...r, phone] : r.filter((x) => x !== phone)))}
              />,
            ];
          })}
          <Field label="Outros números (opcional)" hint="Separe vários por vírgula" className="mt-2">
            {(id, describedBy) => <Input id={id} inputMode="tel" value={extra} aria-describedby={describedBy} onChange={(e) => setExtra(e.target.value)} />}
          </Field>
        </fieldset>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
