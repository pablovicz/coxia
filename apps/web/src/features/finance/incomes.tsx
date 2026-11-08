import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, FolderKanban, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import {
  api,
  apiSend,
  type Income,
  type IncomeSource,
  type ProjectListItem,
  type Space,
} from '@/lib/api';
import { centsToInput, formatBRL, formatDueDate, parseBRL, todayIn } from '@/lib/format';
import { RoomIcon, roomStyle } from '@/lib/rooms';
import { cn } from '@/lib/utils';

export const SOURCE_LABEL: Record<IncomeSource, string> = {
  project: 'Projeto',
  room_rental: 'Aluguel de sala',
  other: 'Outra',
};

/** Prevista com data passada = atrasada (calculado, como no domínio). */
export function incomeStatus(
  i: Income,
  today: string,
): { label: string; variant: 'active' | 'pending' | 'late' | 'archived' | 'neutral' } {
  if (i.status === 'received') return { label: '● Recebida', variant: 'active' };
  if (i.status === 'cancelled') return { label: 'Cancelada', variant: 'archived' };
  if (i.expectedOn.slice(0, 10) < today) return { label: '! Atrasada', variant: 'late' };
  return { label: '◷ Prevista', variant: 'neutral' };
}

function originOf(i: Income): string {
  if (i.source === 'project') return i.project ? `Projeto ${i.project.title}` : 'Projeto';
  if (i.source === 'room_rental')
    return i.space
      ? i.competence
        ? `Aluguel mensal · ${i.space.name}`
        : `Aluguel · ${i.space.name}`
      : 'Aluguel de sala';
  return 'Outra entrada';
}

/** Lista de entradas: data, origem (projeto ou sala, na cor da sala), quem paga, valor e situação. */
export function IncomeList({
  items,
  tz,
  admin,
  onEdit,
}: {
  items: Income[];
  tz: string;
  admin: boolean;
  onEdit?: (i: Income) => void;
}) {
  const [receiving, setReceiving] = useState<Income | null>(null);
  const today = todayIn(tz);
  return (
    <>
      <ul className="divide-y">
        {items.map((i) => {
          const due = formatDueDate(i.expectedOn);
          const status = incomeStatus(i, today);
          const amount =
            i.status === 'received' ? (i.receivedAmountCents ?? i.amountCents) : i.amountCents;
          return (
            <li
              key={i.id}
              className={cn(
                'flex min-h-16 flex-wrap items-center gap-3 py-3',
                i.status === 'cancelled' && 'opacity-60',
              )}
            >
              <div className="grid w-12 shrink-0 place-items-center rounded-md bg-success/12 py-1 text-center leading-tight">
                <span className="text-[11px] uppercase text-muted-foreground">{due.month}</span>
                <span className="tabular text-lg font-semibold">{due.day}</span>
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate font-medium">{i.description}</p>
                <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  {i.space ? (
                    <span style={roomStyle(i.space.color)} className="shrink-0">
                      <RoomIcon icon={i.space.icon} size={14} className="room-text" />
                    </span>
                  ) : i.source === 'project' ? (
                    <FolderKanban size={14} aria-hidden className="shrink-0" />
                  ) : (
                    <ArrowDownLeft size={14} aria-hidden className="shrink-0" />
                  )}
                  <span className="truncate">
                    {originOf(i)}
                    {i.payerName ? ` · ${i.payerName}` : ''}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="tabular font-semibold text-success">+ {formatBRL(amount)}</span>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              {admin && i.status === 'expected' ? (
                <div className="ml-auto flex shrink-0 gap-1">
                  <Button variant="outline" size="sm" onClick={() => setReceiving(i)}>
                    Recebi
                  </Button>
                  {onEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(i)}
                      aria-label={`Editar ${i.description}`}
                    >
                      Editar
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {receiving ? (
        <ReceiveDialog income={receiving} tz={tz} onClose={() => setReceiving(null)} />
      ) : null}
    </>
  );
}

function ReceiveDialog({
  income,
  tz,
  onClose,
}: {
  income: Income;
  tz: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(centsToInput(income.amountCents));
  const [date, setDate] = useState(todayIn(tz));
  const [error, setError] = useState<string | null>(null);
  const receive = useMutation({
    mutationFn: (body: unknown) => apiSend(`/incomes/${income.id}/receive`, 'POST', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incomes'] });
      toast.success('Entrada recebida.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0)
      return setError('Valor inválido. Use, por exemplo, 1.500,00.');
    receive.mutate({ amountCents: cents, receivedOn: date });
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Registrar recebimento"
      description={`${income.description} · previsto ${formatBRL(income.amountCents)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="receive-form" loading={receive.isPending}>
            Confirmar recebimento
          </Button>
        </>
      }
    >
      <form id="receive-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Valor recebido (R$)">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              className="tabular"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Recebido em">
          {(id) => (
            <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Nova entrada (ou edição de uma prevista). Com `projectId`, a origem fica presa ao projeto. */
export function IncomeDialog({
  tz,
  income,
  projectId,
  onClose,
}: {
  tz: string;
  income?: Income | null;
  projectId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fixedProject = !!projectId;
  const [source, setSource] = useState<IncomeSource>(income?.source ?? 'project');
  const [project, setProject] = useState(income?.projectId ?? projectId ?? '');
  const [space, setSpace] = useState(income?.spaceId ?? '');
  const [description, setDescription] = useState(income?.description ?? '');
  const [amount, setAmount] = useState(income ? centsToInput(income.amountCents) : '');
  const [expectedOn, setExpectedOn] = useState(income?.expectedOn.slice(0, 10) ?? todayIn(tz));
  const [payer, setPayer] = useState(income?.payerName ?? '');
  const [notes, setNotes] = useState(income?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectListItem[]>('/projects'),
    enabled: !fixedProject,
  });
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api<Space[]>('/spaces') });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['incomes'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const save = useMutation({
    mutationFn: (body: unknown) =>
      income ? apiSend(`/incomes/${income.id}`, 'PATCH', body) : apiSend('/incomes', 'POST', body),
    onSuccess: () => {
      invalidate();
      toast.success(income ? 'Entrada atualizada.' : 'Entrada prevista lançada.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => apiSend(`/incomes/${income!.id}/cancel`, 'POST'),
    onSuccess: () => {
      invalidate();
      toast.success('Entrada cancelada.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = parseBRL(amount);
    if (!description.trim()) return setError('Descreva a entrada (ex.: Patrocínio — 2ª parcela).');
    if (cents === null || cents <= 0)
      return setError('Informe o valor. Use, por exemplo, 5.000,00.');
    if (!expectedOn) return setError('Informe a data prevista.');
    if (source === 'project' && !project) return setError('Escolha o projeto.');
    save.mutate({
      source,
      description: description.trim(),
      amountCents: cents,
      expectedOn,
      payerName: payer.trim() || null,
      notes: notes.trim() || null,
      projectId: source === 'project' ? project : null,
      spaceId: source === 'room_rental' ? space || null : null,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={income ? 'Editar entrada' : 'Nova entrada'}
      description="Dinheiro a receber, com a data prevista. Quando entrar, marque como recebida."
      footer={
        <>
          {income ? (
            <Button
              variant="ghost"
              className="text-destructive sm:mr-auto"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancelar entrada
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button type="submit" form="income-form" loading={save.isPending}>
            {income ? 'Salvar' : 'Lançar entrada'}
          </Button>
        </>
      }
    >
      <form id="income-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {!fixedProject ? (
          <div
            role="radiogroup"
            aria-label="Origem"
            className="grid grid-cols-3 gap-1 rounded-md border bg-card p-1 sm:col-span-2"
          >
            {(Object.keys(SOURCE_LABEL) as IncomeSource[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                onClick={() => setSource(s)}
                className={cn(
                  'min-h-11 rounded-sm px-1 text-sm font-medium text-muted-foreground',
                  source === s && 'bg-primary text-primary-foreground',
                )}
              >
                {s === 'room_rental' ? 'Sala' : SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
        ) : null}
        {source === 'project' && !fixedProject ? (
          <Field label="Projeto" className="sm:col-span-2">
            {(id) => (
              <Select id={id} value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">Escolha o projeto</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {source === 'room_rental' ? (
          <Field
            label="Sala"
            hint="Aluguel avulso (evento, diária). O mensal entra sozinho pela sala alugada."
            className="sm:col-span-2"
          >
            {(id, describedBy) => (
              <Select
                id={id}
                value={space}
                aria-describedby={describedBy}
                onChange={(e) => setSpace(e.target.value)}
              >
                <option value="">Escolha a sala</option>
                {(spaces.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Descrição" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={description}
              maxLength={160}
              placeholder={
                source === 'project'
                  ? 'Ex.: Patrocínio — 2ª parcela'
                  : source === 'room_rental'
                    ? 'Ex.: Aluguel para ensaio fotográfico'
                    : 'Ex.: Doação'
              }
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label="Valor (R$)">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              className="tabular"
              value={amount}
              placeholder="0,00"
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Data prevista de pagamento">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={expectedOn}
              onChange={(e) => setExpectedOn(e.target.value)}
            />
          )}
        </Field>
        <Field label="Quem paga (opcional)" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={payer}
              maxLength={120}
              placeholder="Ex.: Secretaria de Cultura"
              onChange={(e) => setPayer(e.target.value)}
            />
          )}
        </Field>
        <Field label="Observação (opcional)" className="sm:col-span-2">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Entradas do projeto (patrocínio, parcelas, bilheteria): previsto, recebido e lançamento. */
export function ProjectIncomesCard({ projectId, tz, canEdit }: { projectId: string; tz: string; canEdit: boolean }) {
  const [form, setForm] = useState<Income | 'new' | null>(null);
  const incomes = useQuery({ queryKey: ['incomes', 'project', projectId], queryFn: () => api<Income[]>(`/projects/${projectId}/incomes`) });
  const active = (incomes.data ?? []).filter((i) => i.status !== 'cancelled');
  const expected = active.reduce((s, i) => s + (i.status === 'received' ? (i.receivedAmountCents ?? i.amountCents) : i.amountCents), 0);
  const received = active.filter((i) => i.status === 'received').reduce((s, i) => s + (i.receivedAmountCents ?? i.amountCents), 0);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Entradas</CardTitle>
          <CardDescription>
            {active.length ? `${formatBRL(received)} recebidos de ${formatBRL(expected)} previstos` : 'Patrocínio, parcelas, bilheteria: com a data prevista de pagamento'}
          </CardDescription>
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setForm('new')}>
            <Plus aria-hidden /> Nova
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {incomes.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !incomes.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrada prevista para este projeto.</p>
        ) : (
          <IncomeList items={incomes.data} tz={tz} admin={canEdit} onEdit={(i) => setForm(i)} />
        )}
      </CardContent>
      {form ? <IncomeDialog tz={tz} projectId={projectId} income={form === 'new' ? null : form} onClose={() => setForm(null)} /> : null}
    </Card>
  );
}
