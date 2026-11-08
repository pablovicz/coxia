import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, TriangleAlert, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/input';
import { api, apiSend, type DeadDelivery, type FailedMessage, type OpsOverview } from '@/lib/api';
import { local } from '@/lib/format';
import { WhatsappConnect } from './whatsapp-connect';

const AI_LABEL: Record<string, string> = {
  transcribe: 'Transcrição de áudio',
  interpret_command: 'Comandos',
  extract_briefing: 'Briefing de projeto',
  extract_project_events: 'Eventos de projeto',
};

const fmtInt = new Intl.NumberFormat('pt-BR');

function duration(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/**
 * Operação: saúde da integração (WhatsApp, filas, IA) e reprocessamento manual.
 * Só administração. Atualiza sozinho a cada 30 s.
 */
export function OpsPanel({ tz }: { tz: string }) {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['ops', 'overview'], queryFn: () => api<OpsOverview>('/ops/overview'), refetchInterval: 30_000 });
  const failed = useQuery({ queryKey: ['ops', 'failed'], queryFn: () => api<FailedMessage[]>('/ops/messages/failed') });
  const dead = useQuery({ queryKey: ['ops', 'dead'], queryFn: () => api<DeadDelivery[]>('/ops/deliveries/dead') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['ops'] });

  const retryMessage = useMutation({
    mutationFn: (id: string) => apiSend(`/ops/messages/${id}/retry`, 'POST'),
    onSuccess: () => {
      refresh();
      toast.success('Mensagem de volta à fila.');
    },
    onError: (e) => toast.error(e.message),
  });
  const retryDelivery = useMutation({
    mutationFn: (id: string) => apiSend(`/ops/deliveries/${id}/retry`, 'POST'),
    onSuccess: () => {
      refresh();
      toast.success('Envio de volta à fila.');
    },
    onError: (e) => toast.error(e.message),
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => apiSend('/whatsapp/disconnect', 'POST'),
    onSuccess: () => {
      setConfirmDisconnect(false);
      qc.removeQueries({ queryKey: ['whatsapp'] });
      refresh();
      toast.success('WhatsApp desconectado. Para conectar de novo, use o QR code abaixo.');
    },
    onError: (e) => toast.error(e.message),
  });
  const checkNow = useMutation({
    mutationFn: () => apiSend('/ops/whatsapp/check', 'POST'),
    onSuccess: () => {
      toast.success('Verificação pedida. O estado atualiza em instantes.');
      setTimeout(refresh, 3_000);
    },
    onError: (e) => toast.error(e.message),
  });

  const o = overview.data;
  const wa = o?.whatsapp[0];
  const down = wa ? !wa.connected && !!wa.lastCheckedAt : false;
  const queued = o ? o.outbox.byStatus.pending + o.outbox.byStatus.failed + o.outbox.byStatus.sending : 0;
  const aiCalls = o?.ai.reduce((n, a) => n + a.calls, 0) ?? 0;
  const aiFailures = o?.ai.reduce((n, a) => n + a.failures, 0) ?? 0;

  return (
    <section aria-labelledby="ops-title" className="mt-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 id="ops-title" className="font-display text-2xl font-semibold">
            Operação
          </h2>
          <p className="text-sm text-muted-foreground">WhatsApp, filas e IA nas últimas 24 horas.</p>
        </div>
        <div className="flex gap-2">
          {o && wa?.connected ? (
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmDisconnect(true)}>
              <Unplug aria-hidden /> Desconectar
            </Button>
          ) : null}
          <Button variant="outline" onClick={refresh} aria-label="Atualizar operação">
            <RefreshCw aria-hidden /> <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </div>

      {confirmDisconnect ? (
        <Dialog
          open
          onOpenChange={(v) => !v && setConfirmDisconnect(false)}
          title="Desconectar o WhatsApp?"
          description="A Coxia para de receber e responder mensagens até alguém conectar de novo pelo QR code."
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
                Manter conectado
              </Button>
              <Button variant="destructive" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Desconectar
              </Button>
            </>
          }
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Avisos, lembretes e o briefing ficam em espera e saem quando a conexão voltar.</li>
            <li>Mensagens mandadas para a Coxia enquanto isso não são lidas.</li>
            <li>Use para trocar o número da Coxia ou cortar o acesso de um celular perdido.</li>
          </ul>
        </Dialog>
      ) : null}

      {overview.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar a operação.
        </p>
      ) : !o ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Carregando operação">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          {down && wa ? (
            <div role="alert" className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/8 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="text-sm">
                  <p className="font-semibold">WhatsApp desconectado</p>
                  <p className="text-muted-foreground">
                    Os avisos ficam em espera e saem quando a sessão voltar. Conecte de novo pelo QR code ou pelo código abaixo.
                    {wa.lastError ? ` Último erro: ${wa.lastError}.` : ''}
                  </p>
                </div>
              </div>
              <Button variant="outline" loading={checkNow.isPending} onClick={() => checkNow.mutate()}>
                Verificar agora
              </Button>
            </div>
          ) : null}
          {down && wa ? <WhatsappConnect phone={wa.phone} /> : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              compact
              highlight={!down}
              title="WhatsApp"
              value={!wa ? '—' : wa.connected ? 'Conectado' : 'Desconectado'}
              caption={wa?.lastCheckedAt ? `Verificado ${local(wa.lastCheckedAt, tz).toRelative({ locale: 'pt-BR' })}` : 'Ainda não verificado'}
            />
            <MetricCard
              title="Mensagens"
              value={fmtInt.format(o.inbound.last24h.processed)}
              caption={o.inbound.last24h.failed ? `${o.inbound.last24h.failed} com falha` : o.inbound.oldestPendingSeconds ? `Fila: ${duration(o.inbound.oldestPendingSeconds)}` : 'Nenhuma falha'}
            />
            <MetricCard
              title="Envios"
              value={fmtInt.format(o.outbox.sentLast24h)}
              caption={o.outbox.byStatus.dead ? `${o.outbox.byStatus.dead} não saíram` : queued ? `${queued} na fila há ${duration(o.outbox.oldestPendingSeconds)}` : 'Fila vazia'}
            />
            <MetricCard title="IA" value={fmtInt.format(aiCalls)} caption={aiFailures ? `${aiFailures} falha${aiFailures > 1 ? 's' : ''}` : 'Chamadas sem falha'} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle>Mensagens com falha</CardTitle>
                <CardDescription>Reprocessar é seguro: nada é lançado duas vezes</CardDescription>
              </CardHeader>
              <CardContent>
                {!failed.data?.length ? (
                  <p className="text-sm text-muted-foreground">Nenhuma mensagem com falha.</p>
                ) : (
                  <ul className="divide-y">
                    {failed.data.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {m.senderName ?? m.senderPhone ?? 'Desconhecido'}
                            {m.conversation.group?.name ? <span className="font-normal text-muted-foreground"> · {m.conversation.group.name}</span> : null}
                          </p>
                          <p className="truncate text-sm text-muted-foreground">
                            {local(m.receivedAt, tz).toFormat("dd/LL 'às' HH:mm")} · {m.processingError ?? 'erro desconhecido'}
                          </p>
                        </div>
                        <Button variant="outline" loading={retryMessage.isPending && retryMessage.variables === m.id} onClick={() => retryMessage.mutate(m.id)}>
                          Reprocessar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Envios que não saíram</CardTitle>
                <CardDescription>Esgotaram as tentativas (ex.: número inválido)</CardDescription>
              </CardHeader>
              <CardContent>
                {!dead.data?.length ? (
                  <p className="text-sm text-muted-foreground">Nenhum envio parado.</p>
                ) : (
                  <ul className="divide-y">
                    {dead.data.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{d.text.split('\n')[0]}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            Para {d.recipient} · {d.lastError ?? 'erro desconhecido'}
                          </p>
                        </div>
                        <Button variant="outline" loading={retryDelivery.isPending && retryDelivery.variables === d.id} onClick={() => retryDelivery.mutate(d.id)}>
                          Reenviar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>IA nas últimas 24 horas</CardTitle>
                <CardDescription>Tokens são a base do custo; latência média das chamadas com sucesso</CardDescription>
              </CardHeader>
              <CardContent>
                {o.ai.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma chamada à IA nas últimas 24 horas.</p>
                ) : (
                  <div className="-mx-5 overflow-x-auto px-5">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th scope="col" className="py-2 pr-3 font-medium">Operação</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">Chamadas</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">Falhas</th>
                          <th scope="col" className="py-2 pr-3 text-right font-medium">Tokens (entrada/saída)</th>
                          <th scope="col" className="py-2 text-right font-medium">Latência</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {o.ai.map((a) => (
                          <tr key={a.operation} className="border-b last:border-0">
                            <th scope="row" className="py-2 pr-3 text-left font-medium">{AI_LABEL[a.operation] ?? a.operation}</th>
                            <td className="py-2 pr-3 text-right">{fmtInt.format(a.calls)}</td>
                            <td className="py-2 pr-3 text-right">{a.failures ? <Badge variant="late">{a.failures}</Badge> : '0'}</td>
                            <td className="py-2 pr-3 text-right">
                              {fmtInt.format(a.inputTokens)} / {fmtInt.format(a.outputTokens)}
                            </td>
                            <td className="py-2 text-right">{a.avgLatencyMs ? `${fmtInt.format(a.avgLatencyMs)} ms` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-4 text-[13px] text-muted-foreground">
                  Retenção: o conteúdo de mensagens com mais de {o.retention.days} dias é apagado (comprovantes ficam).
                  {o.retention.lastRunAt ? ` Última limpeza em ${local(o.retention.lastRunAt, tz).toFormat('dd/LL')}.` : ' Nenhuma limpeza ainda.'}
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
