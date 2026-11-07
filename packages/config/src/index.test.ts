import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv, workerEnvSchema } from './index';

const valid = {
  DATABASE_URL: 'postgresql://coxia:coxia@localhost:5432/coxia',
  REDIS_URL: 'redis://localhost:6379',
  ZAPI_WEBHOOK_SECRET: 'x'.repeat(16),
  AI_SERVICE_TOKEN: 'y'.repeat(16),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'coxia',
  S3_ACCESS_KEY_ID: 'minio',
  S3_SECRET_ACCESS_KEY: 'minio123',
};

describe('loadEnv', () => {
  it('aplica defaults do piloto', () => {
    const env = loadEnv(workerEnvSchema, valid);
    expect(env.ORG_DEFAULT_TIMEZONE).toBe('America/Sao_Paulo');
    expect(env.MORNING_BRIEFING_TIME).toBe('08:00');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('lista todos os problemas de uma vez', () => {
    try {
      loadEnv(workerEnvSchema, { ...valid, DATABASE_URL: 'nope', ZAPI_WEBHOOK_SECRET: 'short' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      expect((e as EnvValidationError).issues).toHaveLength(2);
    }
  });
});
