import { describe, it, expect } from 'vitest';
import { BASE_BLOCKS, mergeLiveTools, deriveParamFields, matchBlockKey } from './catalog.js';
import type { ToolMetadata } from './types.js';

function tool(name: string, over: Partial<ToolMetadata> = {}): ToolMetadata {
  return {
    name,
    version: 1,
    description: `desc ${name}`,
    category: 'system',
    riskLevel: 'low',
    requiresApproval: false,
    timeoutMs: 1000,
    inputSchema: {},
    outputSchema: {},
    checksum: 'x',
    ...over,
  };
}

describe('BASE_BLOCKS', () => {
  it('defines the 12 base blocks with required fields', () => {
    expect(BASE_BLOCKS).toHaveLength(12);
    for (const b of BASE_BLOCKS) {
      expect(b.key).toBeTruthy();
      expect(b.label).toBeTruthy();
      expect(b.nodeType).toBeTruthy();
    }
  });

  it('maps the required block kinds', () => {
    const byKey = Object.fromEntries(BASE_BLOCKS.map((b) => [b.key, b]));
    expect(byKey.mail_search.toolRef).toBe('mail.search');
    expect(byKey.mail_attachments.toolRef).toBe('mail.save_attachments_to_s3');
    expect(byKey.rag_search.toolRef).toBe('rag.search');
    expect(byKey.notify_user.toolRef).toBe('notification.send');
    expect(byKey.agent_summarize.agentName).toBe('chat_agent');
    expect(byKey.parse_document.agentName).toBe('document_extraction_agent');
    expect(byKey.request_approval.nodeType).toBe('approval');
    expect(byKey.manual_trigger.nodeType).toBe('manual_trigger');
  });
});

describe('mergeLiveTools', () => {
  it('annotates a base block when its tool is live, marks missing as unavailable', () => {
    const { catalog } = mergeLiveTools(BASE_BLOCKS, [
      tool('rag.search', { riskLevel: 'medium', requiresApproval: true }),
    ]);
    const rag = catalog.find((b) => b.key === 'rag_search');
    expect(rag?.available).toBe(true);
    expect(rag?.riskLevel).toBe('medium');
    expect(rag?.requiresApproval).toBe(true);
    const mail = catalog.find((b) => b.key === 'mail_search');
    expect(mail?.available).toBe(false);
  });

  it('appends live tools not covered by a base block', () => {
    const { catalog } = mergeLiveTools(BASE_BLOCKS, [tool('custom.tool')]);
    const extra = catalog.find((b) => b.toolRef === 'custom.tool');
    expect(extra).toBeDefined();
    expect(extra?.group).toBe('Инструменты');
  });
});

describe('deriveParamFields', () => {
  it('derives fields from a JSON Schema (type → kind, required, enum → select)', () => {
    const fields = deriveParamFields({
      type: 'object',
      properties: {
        query: { type: 'string' },
        k: { type: 'integer' },
        flag: { type: 'boolean' },
        mode: { enum: ['a', 'b'] },
      },
      required: ['query'],
    });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.query.kind).toBe('text');
    expect(byName.query.required).toBe(true);
    expect(byName.k.kind).toBe('number');
    expect(byName.flag.kind).toBe('switch');
    expect(byName.mode.kind).toBe('select');
    expect(byName.mode.options).toEqual([
      { label: 'a', value: 'a' },
      { label: 'b', value: 'b' },
    ]);
  });

  it('returns [] for non-object schemas', () => {
    expect(deriveParamFields(undefined)).toEqual([]);
    expect(deriveParamFields({ type: 'string' })).toEqual([]);
  });
});

describe('matchBlockKey', () => {
  it('matches triggers, approval, agents and tools', () => {
    expect(matchBlockKey({ type: 'manual_trigger' })).toBe('manual_trigger');
    expect(matchBlockKey({ type: 'approval' })).toBe('request_approval');
    expect(matchBlockKey({ type: 'agent', agentName: 'chat_agent' })).toBe('agent_summarize');
    expect(matchBlockKey({ type: 'tool', toolRef: 'rag.search' })).toBe('rag_search');
  });
});
