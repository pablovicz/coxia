import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ApiError, apiSend, type Space, uploadSpacePhoto } from '@/lib/api';
import { centsToInput, parseBRL } from '@/lib/format';
import { ROOM_COLORS, ROOM_ICONS, ROOM_STATUS, type RoomStatus, RoomIcon, roomStyle } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import { fromSimpleHours, sameRules, type SimpleHours, toSimpleHours, WEEKDAYS } from './hours';
import { RoomPhoto } from './room-photo';

export const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Saved = Space & { futureOccurrences?: unknown[] };

/** Cadastro e edição de sala: dados, situação, cor e ícone da agenda, horário e fotos. */
export function RoomForm({ room, onClose }: { room: Space | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!room;
  const [name, setName] = useState(room?.name ?? '');
  const [description, setDescription] = useState(room?.description ?? '');
  const [status, setStatus] = useState<RoomStatus>(room?.status ?? 'available');
  const [color, setColor] = useState(room?.color ?? 'floresta');
  const [icon, setIcon] = useState(room?.icon ?? 'porta');
  const [hourly, setHourly] = useState(room?.hourlyRateCents != null ? centsToInput(room.hourlyRateCents) : '');
  const [rent, setRent] = useState(room?.rentAmountCents != null ? centsToInput(room.rentAmountCents) : '');
  const [rentDay, setRentDay] = useState(room?.rentDueDay != null ? String(room.rentDueDay) : '10');
  const [tenant, setTenant] = useState(room?.tenantName ?? '');
  const initialHours = useMemo(() => toSimpleHours(room?.availabilityRules ?? []), [room]);
  const [hours, setHours] = useState<SimpleHours>(
    editing ? initialHours : { days: [1, 2, 3, 4, 5, 6], opensAt: '08:00', closesAt: '22:00', mixed: false },
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState<Array<{ file: File; url: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Libera as prévias locais ao fechar.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const kept = (room?.photos ?? []).filter((p) => !removed.includes(p.id));
  const photoCount = kept.length + pending.length;

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: Array<{ file: File; url: string }> = [];
    for (const file of Array.from(files)) {
      if (!PHOTO_TYPES.includes(file.type)) {
        toast.error(`${file.name}: use JPG, PNG ou WebP.`);
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        toast.error(`${file.name}: a foto deve ter até 5 MB.`);
        continue;
      }
      if (photoCount + next.length >= MAX_PHOTOS) {
        toast.error(`Cada sala pode ter até ${MAX_PHOTOS} fotos.`);
        break;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setPending((p) => [...p, ...next]);
    if (fileInput.current) fileInput.current.value = '';
  }

  const save = useMutation({
    mutationFn: async () => {
      const rules = fromSimpleHours(hours);
      const rental =
        status === 'monthly_rental' ? { rentAmountCents: parseBRL(rent), rentDueDay: Number(rentDay), tenantName: tenant.trim() || null } : {};
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        status,
        color,
        icon,
        hourlyRateCents: hourly.trim() ? parseBRL(hourly) : null,
        ...rental,
      };
      let saved: Saved;
      if (room) {
        saved = await apiSend<Saved>(`/spaces/${room.id}`, 'PATCH', body);
        if (!sameRules(rules, room.availabilityRules)) await apiSend(`/spaces/${room.id}/availability`, 'PUT', { rules });
        for (const id of removed) await apiSend(`/spaces/${room.id}/photos/${id}`, 'DELETE');
      } else {
        saved = await apiSend<Saved>('/spaces', 'POST', { ...body, availability: rules });
      }
      // Fotos depois da sala: se uma falhar, a sala já está salva e o erro diz qual foto.
      const failed: string[] = [];
      for (const p of pending) {
        try {
          await uploadSpacePhoto(saved.id, p.file);
        } catch (e) {
          failed.push(`${p.file.name} (${e instanceof Error ? e.message : 'erro'})`);
        }
      }
      return { saved, failed };
    },
    onSuccess: ({ saved, failed }) => {
      qc.invalidateQueries({ queryKey: ['spaces'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      const future = saved.futureOccurrences?.length ?? 0;
      if (failed.length) toast.error(`Sala salva, mas ${failed.length === 1 ? 'uma foto não subiu' : `${failed.length} fotos não subiram`}: ${failed.join('; ')}`);
      else toast.success(editing ? 'Sala atualizada.' : 'Sala cadastrada. Ela já aparece na agenda.');
      if (future && status !== 'available') {
        toast.warning(
          `${future === 1 ? 'Há 1 reserva futura' : `Há ${future} reservas futuras`} nesta sala. Elas continuam na agenda: cancele as que não valem mais.`,
          { duration: 10_000 },
        );
      }
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setNameError(e.message);
      else setError(e instanceof Error ? e.message : 'Não foi possível salvar a sala.');
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNameError(null);
    if (!name.trim()) return setNameError('Informe o nome da sala.');
    if (hours.days.length === 0) return setError('Marque pelo menos um dia de funcionamento.');
    if (hours.opensAt >= hours.closesAt) return setError('O horário de abertura deve ser antes do fechamento.');
    if (hourly.trim() && !(parseBRL(hourly) ?? 0)) return setError('Valor da hora inválido. Use, por exemplo, 80,00.');
    if (status === 'monthly_rental') {
      const cents = parseBRL(rent);
      const day = Number(rentDay);
      if (cents === null || cents <= 0) return setError('Informe o valor do aluguel mensal (ex.: 1.800,00).');
      if (!Number.isInteger(day) || day < 1 || day > 31) return setError('Dia do pagamento do aluguel entre 1 e 31.');
    }
    save.mutate();
  }

  const formId = 'room-form';
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      size="wide"
      title={editing ? `Editar ${room.name}` : 'Nova sala'}
      description="A sala disponível aparece na agenda e pode ser reservada pela equipe."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {editing ? 'Salvar' : 'Cadastrar sala'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-x-8 gap-y-5 lg:grid-cols-2" noValidate>
        <div className="flex min-w-0 flex-col gap-5">
          <Field label="Nome" error={nameError}>
            {(id, describedBy) => (
              <Input
                id={id}
                value={name}
                maxLength={80}
                placeholder="Ex.: Sala Grande"
                aria-invalid={!!nameError}
                aria-describedby={describedBy}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}
          </Field>

          <Field label="Descrição" hint="Tamanho, equipamentos, para que serve">
            {(id, describedBy) => (
              <Textarea
                id={id}
                value={description}
                maxLength={1000}
                rows={3}
                placeholder="Ex.: 80 m², piso de madeira, espelho e som"
                aria-describedby={describedBy}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Situação</legend>
            <div role="radiogroup" aria-label="Situação" className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(ROOM_STATUS) as RoomStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    'flex min-h-11 flex-col items-start rounded-md border px-3 py-2 text-left text-sm',
                    status === s ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'hover:bg-muted',
                  )}
                >
                  <span className="font-semibold">{ROOM_STATUS[s].label}</span>
                  <span className="text-xs text-muted-foreground">{ROOM_STATUS[s].hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Cor na agenda</legend>
            <div role="radiogroup" aria-label="Cor na agenda" className="flex flex-wrap gap-2">
              {(Object.keys(ROOM_COLORS) as Array<keyof typeof ROOM_COLORS>).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={ROOM_COLORS[c]}
                  title={ROOM_COLORS[c]}
                  onClick={() => setColor(c)}
                  style={roomStyle(c)}
                  className={cn('grid size-11 place-items-center rounded-full', color === c && 'room-ring')}
                >
                  <span className="room-fill block size-8 rounded-full" />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Ícone</legend>
            <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-7 gap-1.5" style={roomStyle(color)}>
              {Object.entries(ROOM_ICONS).map(([key, { label }]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={icon === key}
                  aria-label={label}
                  title={label}
                  onClick={() => setIcon(key)}
                  className={cn(
                    'grid min-h-11 place-items-center rounded-md border',
                    icon === key ? 'room-soft room-text border-transparent ring-2 ring-[var(--room)]' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <RoomIcon icon={key} size={20} strokeWidth={1.75} />
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="Valor da hora (R$)" hint="Preço da hora de locação da sala (reserva avulsa)">
            {(id, describedBy) => (
              <Input id={id} inputMode="decimal" className="tabular" value={hourly} placeholder="0,00" aria-describedby={describedBy} onChange={(e) => setHourly(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {status === 'monthly_rental' ? (
            <fieldset className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Aluguel mensal</legend>
              <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2">Vira entrada prevista no Financeiro todo mês, no dia do pagamento.</p>
              <Field label="Valor (R$)">
                {(id) => <Input id={id} inputMode="decimal" className="tabular" value={rent} placeholder="0,00" onChange={(e) => setRent(e.target.value)} />}
              </Field>
              <Field label="Dia do pagamento">{(id) => <Input id={id} inputMode="numeric" value={rentDay} onChange={(e) => setRentDay(e.target.value)} />}</Field>
              <Field label="Quem aluga (opcional)" className="sm:col-span-2">
                {(id) => <Input id={id} value={tenant} maxLength={120} placeholder="Ex.: Coletivo Barro" onChange={(e) => setTenant(e.target.value)} />}
              </Field>
            </fieldset>
          ) : null}

          <div>
            <p className="mb-1.5 text-sm font-medium">Na agenda</p>
            <div style={roomStyle(color)} className="room-bar room-soft flex items-center gap-2 rounded-md px-3 py-2 text-sm">
              <RoomIcon icon={icon} size={16} className="room-text shrink-0" />
              <span className="font-semibold">{name.trim() || 'Nome da sala'}</span>
              <span className="text-muted-foreground">· 14h–17h · Ensaio</span>
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Funcionamento</legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias de funcionamento">
              {WEEKDAYS.map((d) => {
                const on = hours.days.includes(d.n);
                return (
                  <button
                    key={d.n}
                    type="button"
                    aria-pressed={on}
                    aria-label={d.long}
                    onClick={() => setHours((h) => ({ ...h, days: on ? h.days.filter((x) => x !== d.n) : [...h.days, d.n] }))}
                    className={cn(
                      'min-h-11 min-w-11 rounded-md border px-2 text-sm font-medium',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Abre às">
                {(id) => <Input id={id} type="time" step={900} value={hours.opensAt} onChange={(e) => setHours((h) => ({ ...h, opensAt: e.target.value }))} />}
              </Field>
              <Field label="Fecha às">
                {(id) => <Input id={id} type="time" step={900} value={hours.closesAt} onChange={(e) => setHours((h) => ({ ...h, closesAt: e.target.value }))} />}
              </Field>
            </div>
            {editing && initialHours.mixed ? (
              <p className="mt-2 text-xs text-muted-foreground">Esta sala tem horários diferentes por dia. Ao mudar aqui, todos os dias marcados ficam com o mesmo horário.</p>
            ) : null}
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">
              Fotos <span className="font-normal text-muted-foreground">(opcional, até {MAX_PHOTOS})</span>
            </legend>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {kept.map((p, i) => (
                <li key={p.id} className="relative overflow-hidden rounded-md border">
                  <RoomPhoto spaceId={room!.id} photoId={p.id} alt={`Foto ${i + 1} de ${room!.name}`} className="aspect-square w-full" />
                  <RemovePhoto label={`Remover foto ${i + 1}`} onClick={() => setRemoved((r) => [...r, p.id])} />
                </li>
              ))}
              {pending.map((p, i) => (
                <li key={p.url} className="relative overflow-hidden rounded-md border">
                  <img src={p.url} alt={`Nova foto: ${p.file.name}`} className="aspect-square w-full object-cover" />
                  <RemovePhoto
                    label={`Remover ${p.file.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setPending((list) => list.filter((_, j) => j !== i));
                    }}
                  />
                </li>
              ))}
              {photoCount < MAX_PHOTOS ? (
                <li>
                  <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs font-medium text-muted-foreground hover:bg-muted">
                    <ImagePlus size={20} aria-hidden />
                    Adicionar
                    <input
                      ref={fileInput}
                      type="file"
                      accept={PHOTO_TYPES.join(',')}
                      multiple
                      className="sr-only"
                      onChange={(e) => addFiles(e.target.files)}
                    />
                  </label>
                </li>
              ) : null}
            </ul>
            <p className="mt-1.5 text-xs text-muted-foreground">JPG, PNG ou WebP, até 5 MB cada.</p>
          </fieldset>
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

function RemovePhoto({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute right-0 top-0 grid size-11 place-items-center text-white [text-shadow:0_1px_2px_rgb(0_0_0/60%)]"
    >
      <span className="grid size-7 place-items-center rounded-full bg-black/55">
        <X size={16} aria-hidden />
      </span>
    </button>
  );
}
