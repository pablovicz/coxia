/**
 * Exporta os contratos API↔IA como JSON Schema em packages/contracts/schemas/.
 * O serviço FastAPI compara seus modelos Pydantic com estes arquivos (apps/ai/tests/test_contracts.py).
 * Rodar `pnpm contracts:export` após alterar qualquer contrato e versionar o resultado.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import * as c from '../src';

const out = join(__dirname, '..', 'schemas');
mkdirSync(out, { recursive: true });

const schemas: Record<string, z.ZodType> = {
  TranscribeRequest: c.transcribeRequest,
  TranscribeResponse: c.transcribeResponse,
  ExtractBriefingRequest: c.extractBriefingRequest,
  ExtractBriefingResponse: c.extractBriefingResponse,
  ExtractProjectEventsRequest: c.extractProjectEventsRequest,
  ExtractProjectEventsResponse: c.extractProjectEventsResponse,
  InterpretCommandRequest: c.interpretCommandRequest,
  InterpretCommandResponse: c.interpretCommandResponse,
  AiErrorResponse: c.aiErrorResponse,
  InboundMessage: c.inboundMessage,
};

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(json, null, 2) + '\n');
  console.log(`schemas/${name}.json`);
}
