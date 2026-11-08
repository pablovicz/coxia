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
  /** Briefing matinal, avisos de contas/reservas e lembretes (idempotente; roda a cada minuto). */
  runNotifications: 'run-notifications',
  generateBillOccurrences: 'generate-bill-occurrences',
  extendBookingSeries: 'extend-booking-series',
  /** Expurga conteúdo de mensagens e mídias mais antigas que organizations.retention_days. */
  applyRetention: 'apply-retention',
  /** Relê os participantes dos grupos ativos no provedor (contatos: entradas, saídas e nomes). */
  syncGroupContacts: 'sync-group-contacts',
  /** Nome e foto dos contatos no WhatsApp (novos primeiro; renova a cada 3 dias). */
  refreshContactProfiles: 'refresh-contact-profiles',
} as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[keyof typeof MAINTENANCE_JOBS];
