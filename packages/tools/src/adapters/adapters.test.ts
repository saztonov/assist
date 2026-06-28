import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { InMemoryAuditSink } from '@su10/audit';
import { ValidationError } from '@su10/errors';
import { ToolBroker } from '../broker.js';
import { ToolRegistry } from '../registry.js';
import type { ToolContext, ToolDefinition } from '../types.js';
import { toLangGraphTool } from './langgraph.js';
import { makeToolInvokeActivity } from './temporal.js';
import { runWorkflowNode } from './visual-builder.js';

const echoTool: ToolDefinition = {
  name: 'echo',
  version: 1,
  description: 'Echoes',
  category: 'system',
  riskLevel: 'low',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  timeoutMs: 1000,
  async handler(input) {
    return input;
  },
};

function broker(): ToolBroker {
  const r = new ToolRegistry();
  r.register(echoTool);
  return new ToolBroker(r);
}

const ctx = (): ToolContext => ({
  subject: { id: 'u', roles: ['echo'] },
  auditSink: new InMemoryAuditSink(),
  at: '2026-01-01T00:00:00.000Z',
});

describe('адаптеры funnel через broker.invoke', () => {
  it('LangGraph adapter вызывает инструмент через брокер', async () => {
    const tool = toLangGraphTool(
      broker(),
      { name: 'echo', description: 'Echoes', inputSchema: echoTool.inputSchema },
      ctx,
    );
    expect(tool.name).toBe('echo');
    expect(await tool.invoke({ text: 'hi' })).toEqual({ text: 'hi' });
  });

  it('Temporal activity adapter реконструирует ctx и funnelит', async () => {
    const activity = makeToolInvokeActivity(broker(), { auditSink: new InMemoryAuditSink() });
    const out = await activity({
      name: 'echo',
      input: { text: 'hi' },
      subjectId: 'u',
      roles: ['echo'],
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(out).toEqual({ text: 'hi' });
  });

  it('Visual-builder adapter маппит узел в broker.invoke', async () => {
    const out = await runWorkflowNode(
      broker(),
      { id: 'n1', type: 'tool', toolRef: 'echo', params: { text: 'hi' } },
      ctx(),
    );
    expect(out).toEqual({ text: 'hi' });
  });

  it('Visual-builder без toolRef → ValidationError', async () => {
    await expect(
      runWorkflowNode(broker(), { id: 'n1', type: 'noop', params: {} }, ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
