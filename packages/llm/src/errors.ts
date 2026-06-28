/**
 * Typed LLM errors. NODE-ONLY.
 *
 * All map to safe `AppError`s. Public messages and `meta` NEVER contain the LM
 * Studio token, prompt bodies, documents or raw upstream payloads.
 */
import { AppError } from '@su10/errors';

export const LLM_ERROR_CODES = {
  AUTH: 'LLM_AUTH_FAILED',
  MODEL_NOT_FOUND: 'LLM_MODEL_NOT_FOUND',
  INVALID_JSON: 'LLM_INVALID_JSON',
  EMPTY_CONTENT: 'LLM_EMPTY_CONTENT',
  TIMEOUT: 'LLM_TIMEOUT',
  UPSTREAM: 'LLM_UPSTREAM',
  BAD_RESPONSE: 'LLM_BAD_RESPONSE',
  NO_EMBEDDING_PROVIDER: 'LLM_NO_EMBEDDING_PROVIDER',
} as const;

export type LlmErrorCode = (typeof LLM_ERROR_CODES)[keyof typeof LLM_ERROR_CODES];

export class LlmGatewayError extends AppError {
  constructor(code: LlmErrorCode, publicMessage: string, httpStatus = 502, meta?: Record<string, unknown>) {
    super({ code, httpStatus, publicMessage, meta });
  }
}

/** Whether an error is worth retrying (transient upstream/timeout only). */
export function isRetryableLlmError(err: unknown): boolean {
  return (
    err instanceof LlmGatewayError &&
    (err.code === LLM_ERROR_CODES.UPSTREAM || err.code === LLM_ERROR_CODES.TIMEOUT)
  );
}

export const authError = (): LlmGatewayError =>
  new LlmGatewayError(LLM_ERROR_CODES.AUTH, 'LLM authentication failed', 502);

export const modelNotFoundError = (model: string): LlmGatewayError =>
  new LlmGatewayError(LLM_ERROR_CODES.MODEL_NOT_FOUND, 'LLM model not found', 502, { model });

export const timeoutError = (model: string): LlmGatewayError =>
  new LlmGatewayError(LLM_ERROR_CODES.TIMEOUT, 'LLM request timed out', 504, { model });

export const upstreamError = (status: number, model?: string): LlmGatewayError =>
  new LlmGatewayError(LLM_ERROR_CODES.UPSTREAM, 'LLM upstream error', 502, { status, model });

export const badResponseError = (model?: string): LlmGatewayError =>
  new LlmGatewayError(LLM_ERROR_CODES.BAD_RESPONSE, 'LLM returned an unexpected response', 502, {
    model,
  });

export const emptyContentError = (model: string): LlmGatewayError =>
  new LlmGatewayError(LLM_ERROR_CODES.EMPTY_CONTENT, 'LLM returned empty content', 502, { model });

export const invalidJsonError = (model: string): LlmGatewayError =>
  new LlmGatewayError(LLM_ERROR_CODES.INVALID_JSON, 'LLM returned invalid JSON', 502, { model });

export const noEmbeddingProviderError = (): LlmGatewayError =>
  new LlmGatewayError(
    LLM_ERROR_CODES.NO_EMBEDDING_PROVIDER,
    'No embedding provider configured',
    500,
  );
