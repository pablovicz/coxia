import { apiEnvSchema, loadEnv, type ApiEnv } from '@coxia/config';

/** Token de injeção para a configuração validada. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}

export type { ApiEnv };
