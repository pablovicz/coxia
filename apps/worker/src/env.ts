import { loadEnv, workerEnvSchema, type WorkerEnv } from '@coxia/config';

export const WORKER_ENV = Symbol('WORKER_ENV');

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return loadEnv(workerEnvSchema, source);
}

export type { WorkerEnv };
