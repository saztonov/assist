import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, ToolBroker, type ToolDefinition } from './index.js';
import { InMemoryAuditSink } from '@su10/audit';

const echoTool: ToolDefinition<{ text: string }, { text: string }> = {
  name: 'echo',
  description: 'Echoes input',
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  riskLevel: 'low',
  async execute(input) {
    return input;
  },
};

const ctx = () => ({ auditSink: new InMemoryAuditSink(), at: '2026-01-01T00:00:00Z' });

describe('tools', () => {
  it('registry rejects a tool missing required fields', () => {
    const r = new ToolRegistry();
    expect(() => r.register({ name: 'bad' } as unknown as ToolDefinition)).toThrow(/missing required field/);
  });

  it('broker runs a low-risk tool for an authorized subject', async () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    const out = await new ToolBroker(r).invoke('echo', { text: 'hi' }, {
      subject: { id: 'u', roles: ['echo'] },
      ...ctx(),
    });
    expect(out).toEqual({ text: 'hi' });
  });

  it('broker blocks a high-risk tool without approval', async () => {
    const r = new ToolRegistry();
    r.register({ ...echoTool, name: 'danger', riskLevel: 'high' });
    await expect(
      new ToolBroker(r).invoke('danger', { text: 'x' }, {
        subject: { id: 'u', roles: ['danger'] },
        ...ctx(),
      }),
    ).rejects.toThrow(/approval/i);
  });
});
