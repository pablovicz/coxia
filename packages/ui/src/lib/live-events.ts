import { useEffect, useRef } from 'react';

/** O que mudou (só ids): a tela recarrega pela api normal. */
export interface LiveChange {
  type: 'booking.changed' | 'contract.changed' | 'hours.changed' | 'access.changed' | 'income.changed';
  contractId: string | null;
  spaceId: string | null;
  residentId: string | null;
}

/**
 * Atualização em tempo real (SSE). O EventSource não manda o header Authorization, então
 * cada conexão usa um ticket de 60 s pedido à api. Cai a conexão → reconecta com backoff
 * (o polling das telas continua cobrindo o intervalo).
 */
export function useLiveEvents(opts: {
  enabled: boolean;
  baseUrl: string;
  getTicket: () => Promise<string>;
  onChange: (change: LiveChange) => void;
  /** Chamado ao (re)conectar: o que mudou enquanto estava desconectado precisa ser relido. */
  onReconnect?: () => void;
}) {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!opts.enabled || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    let connectedOnce = false;

    const connect = async () => {
      if (stopped) return;
      try {
        const ticket = await latest.current.getTicket();
        if (stopped) return;
        source = new EventSource(`${latest.current.baseUrl.replace(/\/$/, '')}/events?ticket=${encodeURIComponent(ticket)}`);
        source.addEventListener('ready', () => {
          if (connectedOnce) latest.current.onReconnect?.();
          connectedOnce = true;
          attempt = 0;
        });
        source.addEventListener('change', (e) => {
          try {
            latest.current.onChange(JSON.parse((e as MessageEvent<string>).data) as LiveChange);
          } catch {
            /* evento malformado */
          }
        });
        source.onerror = () => {
          source?.close();
          schedule();
        };
      } catch {
        schedule();
      }
    };
    const schedule = () => {
      if (stopped) return;
      attempt += 1;
      timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    };

    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [opts.enabled, opts.baseUrl]);
}
