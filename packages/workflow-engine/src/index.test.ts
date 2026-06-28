import { describe, it, expect } from 'vitest';
import {
  assertNoSecretsInPayload,
  ACTIVITY_RETRY,
  GenericAgentTaskInputSchema,
  VisualTemplateInputSchema,
  APPROVAL_DECISION_SIGNAL,
  CANCEL_SIGNAL,
} from './index.js';

describe('workflow-engine contracts', () => {
  it('parses generic input with defaults (ids/refs only)', () => {
    const input = GenericAgentTaskInputSchema.parse({
      taskId: 't1',
      subject: { id: 'u1', roles: ['agent.run'] },
    });
    expect(input.agentName).toBe('chat_agent');
    expect(input.requireApproval).toBe(false);
  });

  it('exposes stable signal names + retry policy', () => {
    expect(APPROVAL_DECISION_SIGNAL).toBe('approvalDecision');
    expect(CANCEL_SIGNAL).toBe('cancelWorkflow');
    expect(ACTIVITY_RETRY.maximumAttempts).toBeGreaterThan(1);
  });

  it('assertNoSecretsInPayload rejects secret-like keys/values', () => {
    expect(() => assertNoSecretsInPayload({ taskId: 't1', nested: { ok: 1 } })).not.toThrow();
    expect(() => assertNoSecretsInPayload({ apiKey: 'x' })).toThrow();
    expect(() => assertNoSecretsInPayload({ url: 'Bearer abc' })).toThrow();
  });

  it('visual template input requires a workflow template', () => {
    const parsed = VisualTemplateInputSchema.parse({
      taskId: 't1',
      subject: { id: 'u1', roles: [] },
      template: { id: 'tpl', name: 'demo', nodes: [], edges: [] },
    });
    expect(parsed.template.name).toBe('demo');
  });
});
