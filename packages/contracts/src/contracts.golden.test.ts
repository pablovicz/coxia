import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as c from './index';

/**
 * Golden de contrato API↔IA: os mesmos exemplos são validados aqui (zod) e em
 * apps/ai/tests/test_contracts.py (Pydantic). Se um lado aceitar o que o outro rejeita, o CI quebra.
 */
const dir = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'contracts');

const SCHEMAS: Record<string, z.ZodType> = {
  TranscribeResponse: c.transcribeResponse,
  ExtractBriefingResponse: c.extractBriefingResponse,
  ExtractProjectEventsResponse: c.extractProjectEventsResponse,
  InterpretCommandResponse: c.interpretCommandResponse,
  AiErrorResponse: c.aiErrorResponse,
};

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('golden: contratos API↔IA', () => {
  it('toda fixture corresponde a um schema conhecido', () => {
    for (const f of files) expect(SCHEMAS[f.replace(/\.json$/, '')], f).toBeDefined();
  });

  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    const { valid, invalid } = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
      valid: unknown[];
      invalid: Array<Record<string, unknown>>;
    };

    it.each(valid.map((v, i) => [i, v] as const))(`${name} válido #%i`, (_i, example) => {
      const result = SCHEMAS[name]!.safeParse(example);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });

    it.each(invalid.map((v) => [v._why, v] as const))(`${name} inválido: %s`, (_why, example) => {
      const { _why: _, ...payload } = example;
      expect(SCHEMAS[name]!.safeParse(payload).success).toBe(false);
    });
  }
});
