/**
 * LLM call telemetry port. NODE-ONLY.
 *
 * Records METADATA ONLY (ids, hashes, status, durations, token counts, redacted
 * error codes) — never raw prompts/documents/tokens. Shape mirrors the safe
 * `llm_calls` / `provider_usage_events` columns; the DB-backed implementation
 * lives in `@su10/db`.
 */

export type LlmCallStatus = 'success' | 'error';

export interface LlmCallEvent {
  providerId?: string;
  modelId?: string;
  /** Task class: 'chat' | 'ocr' | 'extraction' | 'analysis' | 'embedding' | ... */
  purpose?: string;
  taskId?: string;
  agentRunId?: string;
  status: LlmCallStatus;
  /** sha256 of the request payload (NOT the payload itself). */
  promptHash?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Stable error code (e.g. 'LLM_TIMEOUT'); never a raw upstream message. */
  redactedErrorCode?: string;
}

export interface LlmCallRecorder {
  record(event: LlmCallEvent): Promise<void>;
}

/** Captures events in memory (tests). */
export class InMemoryLlmCallRecorder implements LlmCallRecorder {
  readonly events: LlmCallEvent[] = [];
  async record(event: LlmCallEvent): Promise<void> {
    this.events.push(event);
  }
}

/** Discards events (default when no recorder is wired). */
export const noopLlmCallRecorder: LlmCallRecorder = {
  async record(): Promise<void> {
    /* no-op */
  },
};
