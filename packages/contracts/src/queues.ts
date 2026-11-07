/** Filas BullMQ compartilhadas entre api (produtor) e worker (consumidor). */
export const QUEUES = {
  /** Processamento de mensagens recebidas (jobId = messages.id → deduplicado pelo BullMQ). */
  inbound: 'inbound-messages',
  /** Tarefas periódicas: despacho do outbox, reconciliação, verificação de conexão, briefing. */
  maintenance: 'maintenance',
} as const;

export interface InboundMessageJob {
  messageId: string;
  organizationId: string;
  traceId: string | null;
}

export const MAINTENANCE_JOBS = {
  dispatchOutbox: 'dispatch-outbox',
  reconcileInbound: 'reconcile-inbound',
  checkConnection: 'check-whatsapp-connection',
  morningBriefing: 'morning-briefing',
} as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[keyof typeof MAINTENANCE_JOBS];
