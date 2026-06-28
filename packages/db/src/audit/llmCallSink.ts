/**
 * DB-backed LLM call telemetry → `llm_calls` + `provider_usage_events`.
 *
 * Stores METADATA ONLY (ids, hashes, status, durations, token counts, redacted
 * error codes) — never raw prompts/documents/tokens. The event shape mirrors
 * `@su10/llm`'s `LlmCallRecorder` structurally (no package coupling).
 */
import { llmCalls, providerUsageEvents } from '../schema/providers.js';
import type { Database } from '../index.js';

/** Structurally compatible with `@su10/llm`'s `LlmCallEvent`. */
export interface LlmCallEventInput {
  providerId?: string;
  modelId?: string;
  purpose?: string;
  taskId?: string;
  agentRunId?: string;
  status: 'success' | 'error';
  promptHash?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  redactedErrorCode?: string;
}

export type LlmCallRow = typeof llmCalls.$inferInsert;
export type ProviderUsageRow = typeof providerUsageEvents.$inferInsert;

/** Pure mapping (testable without a DB). `providerId` label is NOT a uuid → omitted. */
export function mapLlmCallToRows(event: LlmCallEventInput): {
  call: LlmCallRow;
  usage: ProviderUsageRow;
} {
  return {
    call: {
      modelId: event.modelId ?? null,
      taskId: event.taskId ?? null,
      agentRunId: event.agentRunId ?? null,
      purpose: event.purpose ?? null,
      status: event.status,
      promptHash: event.promptHash ?? null,
      durationMs: event.durationMs ?? null,
      inputTokens: event.inputTokens ?? null,
      outputTokens: event.outputTokens ?? null,
      redactedErrorCode: event.redactedErrorCode ?? null,
    },
    usage: {
      modelId: event.modelId ?? null,
      taskId: event.taskId ?? null,
      requestHash: event.promptHash ?? null,
      status: event.status,
      durationMs: event.durationMs ?? null,
      inputTokens: event.inputTokens ?? null,
      outputTokens: event.outputTokens ?? null,
      redactedErrorCode: event.redactedErrorCode ?? null,
    },
  };
}

export function createDbLlmCallRecorder(db: Database): {
  record(event: LlmCallEventInput): Promise<void>;
} {
  return {
    async record(event: LlmCallEventInput): Promise<void> {
      const { call, usage } = mapLlmCallToRows(event);
      await db.insert(llmCalls).values(call);
      await db.insert(providerUsageEvents).values(usage);
    },
  };
}
