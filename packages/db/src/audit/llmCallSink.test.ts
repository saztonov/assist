import { describe, it, expect } from 'vitest';
import { mapLlmCallToRows } from './llmCallSink.js';

describe('mapLlmCallToRows', () => {
  it('maps a success event to call + usage rows (metadata only)', () => {
    const { call, usage } = mapLlmCallToRows({
      modelId: 'qwen36-27b-mtp',
      purpose: 'analysis',
      status: 'success',
      promptHash: 'a'.repeat(64),
      durationMs: 12,
      inputTokens: 3,
      outputTokens: 5,
    });
    expect(call.status).toBe('success');
    expect(call.modelId).toBe('qwen36-27b-mtp');
    expect(call.promptHash).toBe('a'.repeat(64));
    expect(usage.requestHash).toBe('a'.repeat(64));
    // No raw prompt/content fields exist on the rows.
    expect(Object.keys(call)).not.toContain('content');
  });

  it('maps an error event with a redacted error code', () => {
    const { call } = mapLlmCallToRows({ status: 'error', redactedErrorCode: 'LLM_TIMEOUT' });
    expect(call.status).toBe('error');
    expect(call.redactedErrorCode).toBe('LLM_TIMEOUT');
    expect(call.modelId).toBeNull();
  });
});
