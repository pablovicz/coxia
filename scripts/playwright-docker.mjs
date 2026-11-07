#!/usr/bin/env node
/**
 * Roda os testes Playwright do apps/web no container Linux oficial — mesma renderização do CI.
 * Uso: node scripts/playwright-docker.mjs [--update-snapshots] [args do playwright]
 * node_modules do host (Windows/macOS) não servem no Linux: volumes nomeados guardam os do container.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'apps/web/node_modules/@playwright/test/package.json'), 'utf8')).version;
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const args = process.argv.slice(2);

const pnpmVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager.split('@')[1];

const script = [
  // A imagem do Playwright usa Node 26, que não traz mais o corepack.
  `npm install -g --silent pnpm@${pnpmVersion}`,
  // Store fora do bind mount; senão o pnpm cria /repo/.pnpm-store no projeto.
  'pnpm install --frozen-lockfile --filter @coxia/web --store-dir /pnpm-store --config.confirmModulesPurge=false >/dev/null',
  `pnpm --filter @coxia/web exec playwright test ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
].join(' && ');

const result = spawnSync(
  'docker',
  [
    'run', '--rm', '--ipc=host',
    '-e', 'CI=1',
    '-v', `${root}:/repo`,
    '-v', 'coxia-pw-root-modules:/repo/node_modules',
    '-v', 'coxia-pw-web-modules:/repo/apps/web/node_modules',
    '-v', 'coxia-pw-pnpm-store:/pnpm-store',
    '-w', '/repo',
    image,
    'bash', '-lc', script,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
