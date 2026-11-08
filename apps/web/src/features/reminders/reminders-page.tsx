import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Plus, ReceiptText, Repeat } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, PageHeader } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/input';
import { api, apiSend, type AutomaticReminder, canBook, type Reminder } from '@/lib/api';
import { formatBRL, formatPhone, local, todayIn } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { REMINDER_TYPES, ReminderForm } from './reminder-form';

/** "hoje às 14h", "amanhã às 9h30", "sex, 14/11 às 10h". */
export function whenLabel(iso: string, tz: string): string {
  const d = local(iso, tz);
  const day = d.toISODate();
  const today = todayIn(tz);
  const time = d.minute === 0 ? `${d.hour}h` : `${d.hour}h${String(d.minute).padStart(2, '0')}`;
  if (day === today) return `hoje às ${time}`;
  if (day === DateTime.fromISO(today).plus({ days: 1 }).toISODate()) return `amanhã às ${time}`;
  return `${d.toFormat('ccc, dd/LL').replace('.', '')} às ${time}`;
}

export function repeatLabel(rule: string | null): string | null {
  if (!rule) return null;
  if (rule.startsWith('FREQ=MONTHLY')) return 'todo mês';
  const days = /BYDAY=([A-Z,]+)/.exec(rule)?.[1]?.split(',') ?? [];
  if (days.length === 7) return 'todo dia';
  if (days.length === 5 && !days.includes('SA') && !days.includes('SU')) return 'dias úteis';
  return 'toda semana';
}

const personOf = (r: Reminder) =>
  r.contact ? { name: r.contact.name ?? r.contact.whatsappName, phone: r.contact.phone || null } : { name: r.personName, phone: r.personPhone };

/**
 * Lembretes: os da equipe ("ligar para a Carla às 14h") e os automáticos das contas,
 * que a Coxia dispara sozinha na véspera e no dia do vencimento até a conta ser paga.
 */
export function RemindersPage() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const mayEdit = canBook(session?.user.role);
  const [creating, setCreating] = useState(false);
  const reminders = useQuery({ queryKey: ['reminders', 'list'], queryFn: () => api<Reminder[]>('/reminders') });
  const automatic = useQuery({ queryKey: ['reminders', 'automatic'], queryFn: () => api<AutomaticReminder[]>('/reminders/automatic') });

  const active = (reminders.data ?? []).filter((r) => r.active);
  const done = (reminders.data ?? []).filter((r) => !r.active).slice(0, 8);

  return (
    <>
      <PageHeader
        eyebrow="Agenda da equipe"
        title="Lembretes."
        description="Avisos pelo WhatsApp no horário marcado: ligar para alguém, mandar mensagem ou não esquecer de algo."
        action={
          mayEdit ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Novo lembrete
            </Button>
          ) : null
        }
      />

      <section aria-labelledby="next-title">
        <h2 id="next-title" className="mb-3 text-lg font-semibold">
          Próximos
        </h2>
        {reminders.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : reminders.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar os lembretes.
          </p>
        ) : active.length === 0 ? (
          <EmptyState icon={Bell} title="Nenhum lembrete agendado">
            Crie um lembrete — por exemplo, “Ligar para a Carla às 14h” — e a Coxia avisa pelo WhatsApp na hora.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((r) => (
              <li key={r.id}>
                <ReminderCard reminder={r} tz={tz} mayEdit={mayEdit} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="mt-8">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Automáticos das contas</CardTitle>
            <CardDescription>Cada conta avisa na véspera e no dia do vencimento, no horário do briefing, até ser paga</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/contas">
              <ReceiptText aria-hidden /> Contas
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {automatic.isPending ? (
            <Skeleton className="h-24" />
          ) : !automatic.data?.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta ativa. Ao cadastrar uma conta, os avisos dela aparecem aqui.</p>
          ) : (
            <ul className="divide-y">
              {automatic.data.map((a) => (
                <AutomaticRow key={a.billId} item={a} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {done.length ? (
        <details className="group mt-8">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground">
            <Check size={16} aria-hidden /> Enviados e concluídos ({done.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2 opacity-75">
            {done.map((r) => (
              <li key={r.id}>
                <ReminderCard reminder={r} tz={tz} mayEdit={false} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {creating ? <ReminderForm tz={tz} onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function ReminderCard({ reminder: r, tz, mayEdit }: { reminder: Reminder; tz: string; mayEdit: boolean }) {
  const qc = useQueryClient();
  const finish = useMutation({
    mutationFn: () => apiSend(`/reminders/${r.id}/deactivate`, 'POST'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      toast.success(r.kind === 'recurring' ? 'Lembrete encerrado: não repete mais.' : 'Lembrete concluído.');
    },
    onError: (e) => toast.error(e.message),
  });
  const { Icon } = REMINDER_TYPES[r.type];
  const person = personOf(r);
  const repeat = repeatLabel(r.recurrenceRule);
  const when = r.active ? r.nextRunAt : (r.lastSentAt ?? r.dueAt);
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{r.title}</p>
        <p className="text-sm text-muted-foreground">
          {when ? (r.active ? whenLabel(when, tz) : `enviado ${local(when, tz).toFormat("dd/LL 'às' HH:mm")}`) : '—'}
          {repeat ? (
            <span className="ml-2 inline-flex items-center gap-1">
              <Repeat size={12} aria-hidden /> {repeat}
            </span>
          ) : null}
        </p>
        {r.type !== 'general' && person.phone ? (
          <p className="mt-1 text-sm">
            <a className="tabular -my-3 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline" href={r.type === 'call' ? `tel:+${person.phone}` : `https://wa.me/${person.phone}`} target={r.type === 'message' ? '_blank' : undefined} rel="noreferrer">
              {formatPhone(person.phone)}
            </a>
          </p>
        ) : null}
        {r.message ? <p className="mt-1 text-sm text-muted-foreground">{r.message}</p> : null}
      </div>
      {mayEdit && r.active ? (
        <Button variant="ghost" size="sm" loading={finish.isPending} onClick={() => finish.mutate()}>
          {r.kind === 'recurring' ? 'Encerrar' : 'Concluir'}
        </Button>
      ) : null}
    </Card>
  );
}

function AutomaticRow({ item: a }: { item: AutomaticReminder }) {
  const next = a.next;
  const due = next ? DateTime.fromISO(next.dueDate).setLocale('pt-BR') : null;
  const amount = next?.remainingCents == null ? null : a.isVariableAmount ? `cerca de ${formatBRL(next.remainingCents)}` : formatBRL(next.remainingCents);
  const to = a.recipients.map((r) => r.name ?? (r.phone ? formatPhone(r.phone) : null)).filter(Boolean);
  const overdue = next?.status === 'overdue';
  return (
    <li className="flex min-h-14 items-start gap-3 py-3">
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <ReceiptText size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Pagar {a.name}</p>
        <p className="text-sm text-muted-foreground">
          {due ? (
            overdue ? (
              <>Atrasada desde {due.toFormat('dd/LL')} · reaviso a cada {a.overdueEveryDays} dias</>
            ) : (
              <>
                Vence {due.toFormat("ccc, dd/LL").replace('.', '')} · avisos em {due.minus({ days: 1 }).toFormat('dd/LL')} e {due.toFormat('dd/LL')}
              </>
            )
          ) : (
            `Todo dia ${a.dueDay}`
          )}
          {amount ? ` · ${amount}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">{to.length ? `Para ${to.join(', ')} e no briefing da manhã` : 'No briefing da manhã'}</p>
      </div>
      {overdue ? <Badge variant="late">Atrasada</Badge> : next?.status === 'partially_paid' ? <Badge variant="pending">Parcial</Badge> : null}
    </li>
  );
}
