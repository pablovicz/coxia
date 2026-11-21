import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, MapPin, Plus, Users, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { MemberCheckbox } from '@/components/member-checkbox';
import { Button } from '@coxia/ui/components/ui/button';
import { Dialog } from '@coxia/ui/components/ui/dialog';
import { Field, Select } from '@coxia/ui/components/ui/field';
import { Input, Textarea } from '@coxia/ui/components/ui/input';
import { ContactPicker } from '@/features/contacts/contact-picker';
import { ProjectPicker } from '@/features/projects/project-picker';
import { api, apiSend, type Appointment, type AppointmentKind, type Contact, type Member } from '@/lib/api';
import { formatPhone, local, toZonedIso } from '@coxia/ui/lib/format';
import { cn } from '@coxia/ui/lib/utils';
import { useAuth } from '@/providers/auth-provider';

export const APPOINTMENT_KINDS: Record<AppointmentKind, { label: string; Icon: typeof Users }> = {
  meeting: { label: 'Reunião', Icon: Users },
  visit: { label: 'Visita', Icon: MapPin },
  event: { label: 'Evento', Icon: CalendarDays },
  other: { label: 'Outro', Icon: CalendarDays },
};

const NOTICE: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'Não avisar' },
  { value: '15', label: '15 minutos antes' },
  { value: '30', label: '30 minutos antes' },
  { value: '60', label: '1 hora antes' },
  { value: '120', label: '2 horas antes' },
  { value: '1440', label: '1 dia antes' },
];

type Guest = { name: string; phone: string };
type PickedContact = { id: string; label: string; phone: string };

const contactLabel = (c: { name: string | null; whatsappName: string | null; phone: string }) => c.name ?? c.whatsappName ?? formatPhone(c.phone);

function nextHour(tz: string, date?: string) {
  const now = DateTime.now().setZone(tz);
  if (date && date !== now.toISODate()) return { date, start: '10:00', end: '11:00' };
  const s = now.hour >= 21 ? now.plus({ days: 1 }).set({ hour: 10, minute: 0 }) : now.plus({ hours: 1 }).startOf('hour');
  return { date: s.toISODate()!, start: s.toFormat('HH:mm'), end: s.plus({ hours: 1 }).toFormat('HH:mm') };
}

/**
 * Compromisso da equipe (reunião, visita, evento…): vai toda a equipe ou só quem for marcado
 * (pode ser uma pessoa só), com contatos e pessoas de fora. Quem é da equipe recebe o aviso.
 */
export function AppointmentForm({
  tz,
  onClose,
  defaultDate,
  appointment,
}: {
  tz: string;
  onClose: () => void;
  defaultDate?: string;
  appointment?: Appointment;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const editing = !!appointment;
  const initial = appointment
    ? {
        date: local(appointment.startAt, tz).toISODate()!,
        start: local(appointment.startAt, tz).toFormat('HH:mm'),
        end: local(appointment.endAt, tz).toFormat('HH:mm'),
      }
    : nextHour(tz, defaultDate);

  const [kind, setKind] = useState<AppointmentKind>(appointment?.kind ?? 'meeting');
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [projectId, setProjectId] = useState<string | null>(appointment?.project?.id ?? null);
  const [allTeam, setAllTeam] = useState(appointment?.allTeam ?? false);
  const [memberIds, setMemberIds] = useState<string[] | null>(
    appointment ? appointment.participants.flatMap((p) => (p.memberId ? [p.memberId] : [])) : null,
  );
  const [contacts, setContacts] = useState<PickedContact[]>(
    appointment?.participants.flatMap((p) => (p.contact ? [{ id: p.contact.id, label: contactLabel(p.contact), phone: p.contact.phone }] : [])) ?? [],
  );
  const [guests, setGuests] = useState<Guest[]>(
    appointment?.participants.flatMap((p) => (!p.memberId && !p.contactId && p.name ? [{ name: p.name, phone: p.phone ?? '' }] : [])) ?? [],
  );
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [notice, setNotice] = useState(appointment ? (appointment.notifyMinutesBefore === null ? 'none' : String(appointment.notifyMinutesBefore)) : '60');
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: () => api<Member[]>('/organization/members') });
  // Novo compromisso: quem cria já vem marcada.
  const selected = memberIds ?? (members.data?.filter((m) => m.userId === session?.user.id).map((m) => m.memberId) ?? []);

  const save = useMutation({
    mutationFn: (body: unknown) => (editing ? apiSend(`/appointments/${appointment!.id}`, 'PUT', body) : apiSend('/appointments', 'POST', body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      toast.success(editing ? 'Compromisso atualizado.' : 'Compromisso marcado.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  function changeStart(v: string) {
    // Mantém a duração ao mudar o início.
    const dur = DateTime.fromFormat(end, 'HH:mm').diff(DateTime.fromFormat(start, 'HH:mm'), 'minutes').minutes;
    setStart(v);
    const s = DateTime.fromFormat(v, 'HH:mm');
    if (s.isValid && dur > 0) setEnd(s.plus({ minutes: dur }).toFormat('HH:mm'));
  }

  function addGuest() {
    if (!guestName.trim()) return setError('Informe o nome da pessoa de fora.');
    setError(null);
    setGuests((g) => [...g, { name: guestName.trim(), phone: guestPhone.trim() }]);
    setGuestName('');
    setGuestPhone('');
  }

  function addContact(c: Contact) {
    setContacts((cs) => (cs.some((x) => x.id === c.id) ? cs : [...cs, { id: c.id, label: contactLabel(c), phone: c.phone }]));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Informe o título do compromisso.');
    if (!date || !start || !end) return setError('Informe a data e os horários.');
    if (end <= start) return setError('O fim precisa ser depois do início.');
    if (!allTeam && selected.length === 0) return setError('Escolha quem da equipe vai (ou toda a equipe).');
    save.mutate({
      kind,
      title: title.trim(),
      location: location.trim() || null,
      notes: notes.trim() || null,
      startAt: toZonedIso(date, start, tz),
      endAt: toZonedIso(date, end, tz),
      allTeam,
      memberIds: allTeam ? [] : selected,
      contactIds: contacts.map((c) => c.id),
      guests: guests.map((g) => ({ name: g.name, phone: g.phone || null })),
      notifyMinutesBefore: notice === 'none' ? null : Number(notice),
      projectId,
    });
  }

  const formId = 'appointment-form';
  return (
    <Dialog
      open
      size="wide"
      onOpenChange={(v) => !v && onClose()}
      title={editing ? 'Editar compromisso' : 'Novo compromisso'}
      description="Reunião, visita, evento… Quem da equipe vai recebe o aviso pelo WhatsApp."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {editing ? 'Salvar' : 'Marcar compromisso'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Tipo de compromisso" className="grid grid-cols-2 gap-1 rounded-md border bg-card p-1 sm:grid-cols-4">
            {(Object.keys(APPOINTMENT_KINDS) as AppointmentKind[]).map((k) => {
              const { label, Icon } = APPOINTMENT_KINDS[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm text-sm font-medium text-muted-foreground',
                    kind === k && 'bg-primary text-primary-foreground',
                  )}
                >
                  <Icon size={16} aria-hidden /> {label}
                </button>
              );
            })}
          </div>
          <Field label="Título">
            {(id) => <Input id={id} value={title} maxLength={120} placeholder="Ex.: Reunião com a Secretaria de Cultura" onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Início">{(id) => <Input id={id} type="time" step={300} value={start} onChange={(e) => changeStart(e.target.value)} />}</Field>
            <Field label="Fim">{(id) => <Input id={id} type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
          </div>
          <Field label="Local (opcional)">
            {(id) => <Input id={id} value={location} maxLength={200} placeholder="Ex.: Sala Pequena, ou o endereço" onChange={(e) => setLocation(e.target.value)} />}
          </Field>
          <ProjectPicker label="Projeto (opcional)" value={projectId} onChange={setProjectId} />
          <Field label="Observações (opcional)">
            {(id) => <Textarea id={id} rows={3} value={notes} maxLength={2000} placeholder="Pauta, o que levar…" onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>

        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Quem da equipe vai</legend>
            <div role="radiogroup" aria-label="Quem da equipe vai" className="mb-2 grid grid-cols-2 gap-1 rounded-md border bg-card p-1">
              {[
                { v: true, label: 'Toda a equipe' },
                { v: false, label: 'Escolher pessoas' },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={allTeam === o.v}
                  onClick={() => setAllTeam(o.v)}
                  className={cn('min-h-11 rounded-sm text-sm font-medium text-muted-foreground', allTeam === o.v && 'bg-primary text-primary-foreground')}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {allTeam ? (
              <p className="text-sm text-muted-foreground">Todas da equipe ficam no compromisso e recebem o aviso.</p>
            ) : (
              <div>
                {(members.data ?? []).map((m) => (
                  <MemberCheckbox
                    key={m.memberId}
                    userId={m.userId}
                    name={m.name}
                    avatarUpdatedAt={m.avatarUpdatedAt}
                    label={m.phone ? m.name : `${m.name} (sem WhatsApp: não recebe aviso)`}
                    checked={selected.includes(m.memberId)}
                    onChange={(on) => setMemberIds(on ? [...selected, m.memberId] : selected.filter((x) => x !== m.memberId))}
                  />
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Contatos (opcional)</legend>
            {contacts.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {contacts.map((c) => (
                  <li key={c.id} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm">
                    {c.label}
                    <button type="button" aria-label={`Tirar ${c.label}`} className="grid size-7 place-items-center rounded-full hover:bg-background" onClick={() => setContacts((cs) => cs.filter((x) => x.id !== c.id))}>
                      <X size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <ContactPicker onPick={addContact} inputId="appointment-contact" />
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Pessoas de fora (opcional)</legend>
            {guests.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {guests.map((g, i) => (
                  <li key={`${g.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm">
                    {g.name}
                    {g.phone ? <span className="text-muted-foreground"> · {g.phone}</span> : null}
                    <button type="button" aria-label={`Tirar ${g.name}`} className="grid size-7 place-items-center rounded-full hover:bg-background" onClick={() => setGuests((gs) => gs.filter((_, j) => j !== i))}>
                      <X size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Nome">{(id) => <Input id={id} value={guestName} maxLength={120} placeholder="Ex.: Marina (patrocínio)" onChange={(e) => setGuestName(e.target.value)} />}</Field>
              <Field label="Telefone (opcional)">
                {(id) => <Input id={id} inputMode="tel" value={guestPhone} placeholder="11 90000-0000" onChange={(e) => setGuestPhone(e.target.value)} />}
              </Field>
              <Button type="button" variant="outline" onClick={addGuest}>
                <Plus aria-hidden /> Adicionar
              </Button>
            </div>
          </fieldset>

          <Field label="Aviso pelo WhatsApp">
            {(id) => (
              <Select id={id} value={notice} onChange={(e) => setNotice(e.target.value)}>
                {NOTICE.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </Select>
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
