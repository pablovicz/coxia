#!/usr/bin/env node
/**
 * Roda os testes de integração contra o ambiente isolado do docker-compose.test.yml.
 *   node scripts/test-integration.mjs            → sobe o ambiente, aplica migrations, testa, derruba
 *   node scripts/test-integration.mjs --keep     → mantém os containers no fim
 * No CI os serviços já estão de pé; use --no-compose.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const compose = !args.has('--no-compose');

const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://coxia:coxia@localhost:55432/coxia_test?schema=public',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:56379',
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:59000',
  S3_BUCKET: 'coxia-media',
  S3_ACCESS_KEY_ID: 'coxia',
  S3_SECRET_ACCESS_KEY: 'coxia-dev-secret',
};

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status ?? 1;
}

const composeArgs = ['compose', '-f', 'docker-compose.test.yml'];
let status = 0;
if (compose) status = run('docker', [...composeArgs, 'up', '-d', '--wait', 'postgres', 'redis', 'minio']);
if (compose && status === 0) status = run('docker', [...composeArgs, 'up', 'minio-init', '--exit-code-from', 'minio-init']);
if (status === 0) status = run('pnpm', ['--filter', '@coxia/database', 'db:deploy']);
if (status === 0) status = run('pnpm', ['turbo', 'run', 'test:integration', '--concurrency=1']);
if (compose && !args.has('--keep')) run('docker', [...composeArgs, 'down', '-v']);
process.exit(status);
