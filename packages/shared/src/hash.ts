import { createHash } from 'node:crypto';

/** JSON com chaves ordenadas, para hashes determinísticos independentemente da ordem dos campos. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}
