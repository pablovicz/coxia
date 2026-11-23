import { z } from 'zod';

/** Variáveis comuns a todos os serviços Node (api e worker). */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ORG_DEFAULT_TIMEZONE: z.string().default('America/Sao_Paulo'),
  /**
   * Check-in dos residentes (link do convite e QR da sala). Desligado: as horas da reserva saem
   * do saldo no horário de qualquer jeito (só não há registro de presença).
   */
  CHECK_IN_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const whatsappEnvSchema = z.object({
  WHATSAPP_PROVIDER: z.enum(['zapi', 'fake']).default('fake'),
  ZAPI_BASE_URL: z.string().url().default('https://api.z-api.io'),
  ZAPI_INSTANCE_ID: z.string().default(''),
  ZAPI_INSTANCE_TOKEN: z.string().default(''),
  ZAPI_CLIENT_TOKEN: z.string().default(''),
  /** Segredo no caminho do callback: /webhooks/zapi/:secret (a Z-API não assina payloads). */
  ZAPI_WEBHOOK_SECRET: z.string().min(16),
});

export const aiClientEnvSchema = z.object({
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_SERVICE_TOKEN: z.string().min(16),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Validade das URLs assinadas de mídia, em segundos. */
  S3_SIGNED_URL_TTL: z.coerce.number().int().positive().default(900),
});

export const apiEnvSchema = baseEnvSchema
  .merge(whatsappEnvSchema)
  .merge(aiClientEnvSchema)
  .merge(storageEnvSchema)
  .extend({
    PORT: z.coerce.number().int().default(3000),
    JWT_SECRET: z.string().min(32),
    // Access token curto; a sessão (refresh token) dura 7 dias a partir do login.
    JWT_EXPIRES_IN: z.string().default('15m'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    /** Organização que recebe os pedidos de orçamento do site público; vazio = a única que existe. */
    SITE_ORGANIZATION_SLUG: z.string().optional(),
  });

/** E-mail (convites e reservas dos residentes). "fake" só registra no log. */
export const emailEnvSchema = z.object({
  EMAIL_PROVIDER: z.enum(['resend', 'fake']).default('fake'),
  RESEND_API_KEY: z.string().optional(),
  /** Remetente: "Nome <email>" (o domínio precisa estar verificado no Resend). */
  EMAIL_FROM: z.string().default('Casa Kaju <reservas@casakaju.com>'),
  /** Avisos para as administradoras (lembretes, contas, compromissos, orçamentos). */
  EMAIL_FROM_NOTICES: z.string().default('Casa Kaju <noreply@casakaju.com>'),
  /** Redefinição de senha do residente. */
  EMAIL_FROM_RECOVERY: z.string().default('Casa Kaju <recovery@casakaju.com>'),
  /** Boas-vindas do residente (convite de acesso ao workspace). */
  EMAIL_FROM_WELCOME: z.string().default('Casa Kaju <contato@casakaju.com>'),
  /** Endereço do workspace do residente, usado nos links dos e-mails. */
  RESIDENT_APP_URL: z.string().url().default('http://localhost:5174'),
  /** Painel da equipe (Coxia), usado nos links dos avisos por e-mail às administradoras. */
  STAFF_APP_URL: z.string().url().default('http://localhost:5173'),
});

export const workerEnvSchema = baseEnvSchema
  .merge(whatsappEnvSchema)
  .merge(aiClientEnvSchema)
  .merge(storageEnvSchema)
  .merge(emailEnvSchema)
  .extend({
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    /** Hora local (HH:mm) do briefing matinal unificado. */
    MORNING_BRIEFING_TIME: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .default('08:00'),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Converte REDIS_URL em opções de conexão aceitas pelo BullMQ/ioredis. */
export function redisConnectionFromUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
  family?: number;
} {
  const u = new URL(url);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(db !== undefined && Number.isInteger(db) ? { db } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    // A rede privada do Railway é IPv6: family 0 resolve IPv4 e IPv6.
    family: 0,
  };
}

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Variáveis de ambiente inválidas:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Valida o ambiente e falha cedo, listando todos os problemas de uma vez. */
export function loadEnv<S extends z.ZodTypeAny>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return parsed.data;
}
