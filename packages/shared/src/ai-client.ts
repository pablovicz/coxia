import {
  aiErrorResponse,
  extractBriefingResponse,
  extractProjectEventsResponse,
  interpretCommandResponse,
  transcribeResponse,
  type ExtractBriefingRequest,
  type ExtractBriefingResponse,
  type ExtractProjectEventsRequest,
  type ExtractProjectEventsResponse,
  type InterpretCommandRequest,
  type InterpretCommandResponse,
  type TranscribeRequest,
  type TranscribeResponse,
} from '@coxia/contracts';
import type { z } from 'zod';

export interface AiClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class AiServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

/**
 * Cliente do serviço FastAPI. Toda resposta é validada pelo contrato antes de chegar ao domínio:
 * se a IA devolver algo fora do schema, falha aqui, não no meio de uma regra de negócio.
 */
export class AiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AiClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  transcribe(req: TranscribeRequest, idempotencyKey: string, traceId?: string): Promise<TranscribeResponse> {
    return this.post('/v1/transcribe', req, transcribeResponse, idempotencyKey, traceId);
  }

  extractBriefing(req: ExtractBriefingRequest, idempotencyKey: string, traceId?: string): Promise<ExtractBriefingResponse> {
    return this.post('/v1/projects/briefing', req, extractBriefingResponse, idempotencyKey, traceId);
  }

  extractProjectEvents(
    req: ExtractProjectEventsRequest,
    idempotencyKey: string,
    traceId?: string,
  ): Promise<ExtractProjectEventsResponse> {
    return this.post('/v1/projects/events', req, extractProjectEventsResponse, idempotencyKey, traceId);
  }

  interpretCommand(
    req: InterpretCommandRequest,
    idempotencyKey: string,
    traceId?: string,
  ): Promise<InterpretCommandResponse> {
    return this.post('/v1/commands/interpret', req, interpretCommandResponse, idempotencyKey, traceId);
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.base()}/health`, { signal: AbortSignal.timeout(3_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private base(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }

  private async post<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
    idempotencyKey: string,
    traceId?: string,
  ): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base()}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.token}`,
          'idempotency-key': idempotencyKey,
          ...(traceId ? { 'x-trace-id': traceId } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AiServiceError(`IA ${path}: ${(err as Error).message}`, 'network', true, null);
    }

    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = aiErrorResponse.safeParse(json);
      if (parsed.success) {
        const e = parsed.data.error;
        throw new AiServiceError(`IA ${path}: ${e.message}`, e.code, e.retryable, res.status);
      }
      throw new AiServiceError(`IA ${path}: HTTP ${res.status}`, 'http_error', res.status >= 500, res.status);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AiServiceError(
        `IA ${path}: resposta fora do contrato: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
        'contract_violation',
        false,
        res.status,
      );
    }
    return parsed.data;
  }
}
