import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Skeleton } from '@/components/ui/input';
import { api, apiSend, type ConnectCode, type WhatsappConnection } from '@/lib/api';

/** O WhatsApp invalida o QR a cada ~20 s; a Z-API recomenda pedir de novo a cada 10–20 s e parar após 3 tentativas. */
const QR_REFRESH_MS = 15_000;
const QR_MAX_ROUNDS = 3;

/**
 * Reconexão do número da Coxia sem sair do painel: QR code (lido pelo celular)
 * ou código de pareamento (digitado no celular). Quando a sessão volta, avisa e atualiza a operação.
 */
export function WhatsappConnect({ phone }: { phone: string | null }) {
  const qc = useQueryClient();
  const [round, setRound] = useState(1);
  const paused = round > QR_MAX_ROUNDS;

  const qr = useQuery({
    queryKey: ['whatsapp', 'qr', round],
    queryFn: () => api<ConnectCode>('/whatsapp/qr-code'),
    enabled: !paused,
    staleTime: QR_REFRESH_MS,
    gcTime: 0,
    retry: false,
  });
  // A cada 15 s um QR novo, até 3 vezes; depois espera um clique (evita gerar QR com a tela esquecida aberta).
  useEffect(() => {
    if (paused || !qr.data || qr.data.kind !== 'qr') return;
    const t = setTimeout(() => setRound((r) => r + 1), QR_REFRESH_MS);
    return () => clearTimeout(t);
  }, [qr.data, paused]);

  // Enquanto a tela está aberta, confere a sessão a cada 5 s para fechar o fluxo sozinho.
  const status = useQuery({
    queryKey: ['whatsapp', 'connection'],
    queryFn: () => api<WhatsappConnection>('/whatsapp/connection'),
    refetchInterval: 5_000,
  });
  const connected = status.data?.connected === true || qr.data?.kind === 'connected';
  useEffect(() => {
    if (!connected) return;
    toast.success('WhatsApp conectado. Os avisos em espera vão sair agora.');
    // O worker confirma a conexão e retoma o envio da fila.
    void apiSend('/ops/whatsapp/check', 'POST').catch(() => undefined);
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ['ops'] }), 3_000);
    return () => clearTimeout(t);
  }, [connected, qc]);

  return (
    <section aria-labelledby="wa-connect-title" className="mb-4 rounded-lg border bg-card p-5 sm:p-6">
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <h3 id="wa-connect-title" className="text-lg font-semibold">
          Conectar o WhatsApp da Coxia
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No celular da Coxia: WhatsApp → <strong className="font-medium text-foreground">Aparelhos conectados</strong> →{' '}
          <strong className="font-medium text-foreground">Conectar aparelho</strong>.
        </p>

        <div className="mt-5 grid size-64 place-items-center rounded-lg border bg-white p-3" aria-live="polite">
          {connected ? (
            <p className="text-sm font-medium text-[#3c7656]">Conectado</p>
          ) : paused ? (
            <div className="flex flex-col items-center gap-3 px-4 text-sm text-[#5d685f]">
              <QrCode size={32} aria-hidden />O QR code expirou.
              <Button variant="outline" onClick={() => setRound(1)}>
                <RefreshCw aria-hidden /> Gerar novo QR code
              </Button>
            </div>
          ) : qr.isError ? (
            <div className="flex flex-col items-center gap-3 px-4 text-sm text-[#ae403f]">
              {qr.error.message}
              <Button variant="outline" onClick={() => qr.refetch()}>
                Tentar de novo
              </Button>
            </div>
          ) : qr.data?.kind === 'qr' ? (
            <img src={qr.data.image} alt="QR code para conectar o WhatsApp da Coxia" className="size-full [image-rendering:pixelated]" />
          ) : qr.data?.kind === 'challenge' ? (
            <p className="px-4 text-sm text-[#5d685f]">
              Este celular pediu a chave de acesso. Conclua a conexão pelo painel da Z-API.
            </p>
          ) : (
            <Skeleton className="size-full bg-[#efeae0]" />
          )}
        </div>
        {!connected && !paused && qr.data?.kind === 'qr' ? (
          <p className="mt-2 text-xs text-muted-foreground">O código muda a cada 15 segundos.</p>
        ) : null}

        <div className="my-5 flex w-full items-center gap-3 text-sm text-muted-foreground" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          ou
          <span className="h-px flex-1 bg-border" />
        </div>

        <PhoneCode defaultPhone={phone} disabled={connected} />
      </div>
    </section>
  );
}

function PhoneCode({ defaultPhone, disabled }: { defaultPhone: string | null; disabled: boolean }) {
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [error, setError] = useState<string | null>(null);
  const code = useMutation({
    mutationFn: () => apiSend<ConnectCode>('/whatsapp/phone-code', 'POST', { phone }),
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (phone.replace(/\D/g, '').length < 10) return setError('Informe o número com DDI e DDD, ex.: 55 11 90000-0000.');
    code.mutate();
  }

  const result = code.data;
  return (
    <form onSubmit={submit} className="w-full text-left" noValidate>
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Smartphone size={18} aria-hidden /> Conectar com código
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Número do WhatsApp da Coxia" error={error} className="flex-1">
          {(id, describedBy) => (
            <Input
              id={id}
              inputMode="tel"
              autoComplete="off"
              placeholder="55 11 90000-0000"
              value={phone}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" loading={code.isPending} disabled={disabled}>
          Gerar código
        </Button>
      </div>
      {result?.kind === 'code' ? (
        <div className="mt-4 rounded-md border bg-muted/50 p-4 text-center">
          <p className="tabular font-mono text-2xl font-semibold tracking-[0.2em]" aria-label={`Código: ${result.code.split('').join(' ')}`}>
            {result.code.length === 8 ? `${result.code.slice(0, 4)}-${result.code.slice(4)}` : result.code}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            No celular: Conectar aparelho → <strong className="font-medium text-foreground">Conectar com número de telefone</strong> e digite o código.
          </p>
        </div>
      ) : result?.kind === 'challenge' ? (
        <p className="mt-3 text-sm text-muted-foreground">Este celular pediu a chave de acesso. Conclua a conexão pelo painel da Z-API.</p>
      ) : null}
    </form>
  );
}
