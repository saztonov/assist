import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, toToolMetadata } from './registry.js';
import type { ToolDefinition } from './types.js';

function makeTool(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
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
    ...over,
  };
}

describe('ToolRegistry', () => {
  it('отклоняет инструмент без обязательных полей', () => {
    const r = new ToolRegistry();
    expect(() => r.register({ name: 'bad' } as unknown as ToolDefinition)).toThrow(
      /missing required field/,
    );
  });

  it('register/get/list', () => {
    const r = new ToolRegistry();
    r.register(makeTool());
    expect(r.get('echo')?.name).toBe('echo');
    expect(r.list()).toHaveLength(1);
  });
});

describe('toToolMetadata / listMetadata', () => {
  it('метаданные НЕ содержат handler и включают JSON Schema + checksum', () => {
    const meta = toToolMetadata(makeTool());
    expect(meta).not.toHaveProperty('handler');
    expect(meta.inputSchema).toMatchObject({ type: 'object' });
    expect(meta.outputSchema).toMatchObject({ type: 'object' });
    expect(meta.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.requiresApproval).toBe(false);
  });

  it('checksum стабилен и чувствителен к версии', () => {
    const a = toToolMetadata(makeTool({ version: 1 }));
    const b = toToolMetadata(makeTool({ version: 1 }));
    const c = toToolMetadata(makeTool({ version: 2 }));
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).not.toBe(c.checksum);
  });

  it('listMetadata проецирует все инструменты без handler', () => {
    const r = new ToolRegistry();
    r.register(makeTool());
    r.register(makeTool({ name: 'echo2' }));
    const all = r.listMetadata();
    expect(all).toHaveLength(2);
    for (const m of all) expect(m).not.toHaveProperty('handler');
  });
});
