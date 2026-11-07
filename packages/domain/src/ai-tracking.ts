import type { AiExecutionMeta } from '@coxia/contracts';
import { stableHash } from '@coxia/shared';
import type { Db } from './common';

export type AiOperation = 'transcribe' | 'extract_briefing' | 'extract_project_events' | 'interpret_command';

/**
 * Executa uma chamada à IA e registra em ai_executions: sucesso com tokens, latência e versões de
 * prompt/parser; falha com o erro. É a base das métricas de custo e de falhas da IA.
 * Cada tentativa (inclusive retries do job) vira uma linha.
 */
export async function trackAi<T extends { meta: AiExecutionMeta }>(
  db: Db,
  input: { organizationId: string; operation: AiOperation; sourceMessageId: string; request: unknown; traceId?: string | null },
  call: () => Promise<T>,
): Promise<{ res: T; executionId: string }> {
  const started = Date.now();
  const requestHash = stableHash(input.request);
  let res: T;
  try {
    res = await call();
  } catch (err) {
    await db.aiExecution
      .create({
        data: {
          organizationId: input.organizationId,
          operation: input.operation,
          status: 'failed',
          latencyMs: Date.now() - started,
          requestHash,
          sourceMessageId: input.sourceMessageId,
          traceId: input.traceId ?? null,
          error: `${(err as { code?: string }).code ?? 'error'}: ${(err as Error).message}`.slice(0, 1000),
        },
      })
      .catch(() => undefined); // registrar a falha nunca esconde o erro original
    throw err;
  }
  const exec = await db.aiExecution.create({
    data: {
      organizationId: input.organizationId,
      operation: input.operation,
      status: 'succeeded',
      model: res.meta.model,
      promptVersion: res.meta.promptVersion,
      parserVersion: res.meta.parserVersion,
      inputTokens: res.meta.inputTokens,
      outputTokens: res.meta.outputTokens,
      latencyMs: res.meta.latencyMs,
      requestHash,
      sourceMessageId: input.sourceMessageId,
      traceId: input.traceId ?? null,
    },
  });
  return { res, executionId: exec.id };
}
