/**
 * Infraestrutura da Coxia no Railway (Infrastructure as Code).
 * Referência: https://docs.railway.com/infrastructure-as-code/reference
 *
 * Fluxo: `railway config plan` → revisar o diff → `railway config apply`.
 * Ambientes: "staging" e "production" (mesmo arquivo, parâmetros por ambiente via ctx).
 *
 * Segredos NUNCA ficam aqui: `preserve()` mantém o valor já definido no Railway e
 * `ctx.shared.X` referencia variáveis compartilhadas do ambiente (criar antes do primeiro apply):
 *   AI_SERVICE_TOKEN, ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN, ZAPI_WEBHOOK_SECRET
 *
 * Builds: todos os serviços usam o Dockerfile do próprio app com contexto na raiz do monorepo
 * (RAILWAY_DOCKERFILE_PATH). O estágio final de cada Dockerfile é o de produção.
 *
 * A CONFIRMAR no primeiro `railway config plan`:
 *  - nomes das variáveis expostas pelo bucket (ENDPOINT, BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY, REGION);
 *  - região do bucket (não pode ser alterada depois de criado);
 *  - geração dos domínios públicos de `api` e `web` (domínio customizado ou gerado pelo Railway).
 */
import { bucket, defineRailway, github, group, postgres, preserve, project, redis, service } from 'railway/iac';

const REPO = 'pablovicz/coxia';
const BUCKET_REGION = 'sjc'; // TODO: confirmar a região disponível mais próxima do Brasil

export default defineRailway((ctx) => {
  const prod = ctx.environment === 'production';
  const branch = 'main';
  const source = () => github(REPO, { branch });

  const db = postgres('postgres');
  const cache = redis('redis');
  const media = bucket('media', { region: BUCKET_REGION });

  const storageEnv = {
    S3_ENDPOINT: media.env.ENDPOINT,
    S3_BUCKET: media.env.BUCKET,
    S3_ACCESS_KEY_ID: media.env.ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: media.env.SECRET_ACCESS_KEY,
    S3_REGION: media.env.REGION,
    S3_FORCE_PATH_STYLE: 'false',
    S3_SIGNED_URL_TTL: '900',
  };

  const whatsappEnv = {
    WHATSAPP_PROVIDER: 'zapi',
    ZAPI_BASE_URL: 'https://api.z-api.io',
    ZAPI_INSTANCE_ID: ctx.shared.ZAPI_INSTANCE_ID,
    ZAPI_INSTANCE_TOKEN: ctx.shared.ZAPI_INSTANCE_TOKEN,
    ZAPI_CLIENT_TOKEN: ctx.shared.ZAPI_CLIENT_TOKEN,
    ZAPI_WEBHOOK_SECRET: ctx.shared.ZAPI_WEBHOOK_SECRET,
  };

  const commonEnv = {
    NODE_ENV: 'production',
    LOG_LEVEL: prod ? 'info' : 'debug',
    ORG_DEFAULT_TIMEZONE: 'America/Sao_Paulo',
    DATABASE_URL: db.env.DATABASE_URL,
    REDIS_URL: cache.env.REDIS_URL,
    // Rede privada: o serviço de IA nunca é exposto publicamente.
    AI_SERVICE_URL: 'http://${{ai.RAILWAY_PRIVATE_DOMAIN}}:${{ai.PORT}}',
    AI_SERVICE_TOKEN: ctx.shared.AI_SERVICE_TOKEN,
    AI_TIMEOUT_MS: '60000',
  };

  const ai = service('ai', {
    source: source(),
    healthcheck: '/health',
    healthcheckTimeout: 30,
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/ai/Dockerfile',
      PORT: '8000',
      AI_SERVICE_TOKEN: ctx.shared.AI_SERVICE_TOKEN,
      AI_PROVIDER: prod ? 'openai' : 'fixture',
      OPENAI_API_KEY: preserve(),
      OPENAI_MODEL: 'gpt-4.1-mini',
      OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
      LOG_LEVEL: prod ? 'info' : 'debug',
    },
  });

  const api = service('api', {
    source: source(),
    healthcheck: '/health',
    healthcheckTimeout: 60,
    // Migrations antes de cada deploy; falha interrompe o deploy.
    preDeploy: 'pnpm --filter @coxia/database db:deploy',
    replicas: prod ? 2 : 1,
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/api/Dockerfile',
      PORT: '3000',
      ...commonEnv,
      ...whatsappEnv,
      ...storageEnv,
      JWT_SECRET: preserve(),
      JWT_EXPIRES_IN: '12h',
      CORS_ORIGINS: 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}',
    },
  });

  const worker = service('worker', {
    source: source(),
    healthcheck: '/health',
    healthcheckTimeout: 60,
    // Uma réplica basta no piloto; o outbox usa SKIP LOCKED e os schedulers são idempotentes.
    replicas: 1,
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/worker/Dockerfile',
      PORT: '3001',
      ...commonEnv,
      ...whatsappEnv,
      ...storageEnv,
      WORKER_CONCURRENCY: '5',
      MORNING_BRIEFING_TIME: '08:00',
    },
  });

  const web = service('web', {
    source: source(),
    healthcheck: '/health',
    env: {
      RAILWAY_DOCKERFILE_PATH: 'apps/web/Dockerfile',
      PORT: '8080',
      // Usado como build arg (ARG VITE_API_URL no Dockerfile).
      VITE_API_URL: 'https://${{api.RAILWAY_PUBLIC_DOMAIN}}',
    },
  });

  return project('coxia', {
    resources: [group('Dados', [db, cache, media]), group('Backend', [api, worker, ai]), web],
  });
});
