import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AuthzError, ValidationError } from '@su10/errors';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import {
  createAgentRuntime,
  createDefaultAgentRuntime,
  createFakeLlmGateway,
  invokeAgentTool,
  type AgentDefinition,
  type AgentRunContext,
  type AgentStepRecord,
} from './index.js';

function ragRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'rag.search',
    version: 1,
    description: 'stub retrieval',
    category: 'system',
    riskLevel: 'low',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({ chunks: z.array(z.object({ content: z.string() })) }),
    timeoutMs: 1000,
    async handler({ query }: { query: string }) {
      return { chunks: [{ content: `doc about ${query}` }] };
    },
  });
  return registry;
}

function makeCtx(
  llm = createFakeLlmGateway(),
  registry = ragRegistry(),
): { ctx: AgentRunContext; records: AgentStepRecord[]; audit: InMemoryAuditSink } {
  const records: AgentStepRecord[] = [];
  const audit = new InMemoryAuditSink();
  const ctx: AgentRunContext = {
    subject: { id: 'u1', roles: ['admin'] },
    broker: new ToolBroker(registry),
    llm,
    auditSink: audit,
    now: () => '2026-06-28T00:00:00.000Z',
    recorder: { record: (r) => void records.push(r) },
  };
  return { ctx, records, audit };
}

describe('agent runtime', () => {
  it('chat_agent answers via the LLM gateway', async () => {
    const { ctx, records } = makeCtx(createFakeLlmGateway({ chat: () => 'pong' }));
    const res = await createDefaultAgentRuntime().runAgentStep('chat_agent', { prompt: 'ping' }, ctx);
    expect(res.output).toBe('pong');
    expect(records.map((r) => r.stepType)).toEqual(['llm', 'output']);
    // Записываются только метаданные/хэши — без сырья.
    expect(JSON.stringify(records)).not.toContain('ping');
  });

  it('rag_agent calls rag.search through the Tool Broker', async () => {
    const { ctx, records, audit } = makeCtx();
    const res = await createDefaultAgentRuntime().runAgentStep('rag_agent', { prompt: 'temporal' }, ctx);
    expect(res.output).toContain('doc about temporal');
    expect(records.some((r) => r.stepType === 'tool' && r.toolName === 'rag.search')).toBe(true);
    expect(audit.events.some((e) => e.action === 'rag.search' && e.outcome === 'success')).toBe(true);
  });

  it('document_extraction_agent returns zod-validated JSON', async () => {
    const schema = z.object({ invoiceNumber: z.string(), total: z.number() });
    const { ctx } = makeCtx(
      createFakeLlmGateway({ chat: () => '{"invoiceNumber":"A-1","total":100}' }),
    );
    const res = await createDefaultAgentRuntime().runAgentStep(
      'document_extraction_agent',
      { prompt: 'extract', schema },
      ctx,
    );
    expect(res.data).toEqual({ invoiceNumber: 'A-1', total: 100 });
  });

  it('document_extraction_agent rejects non-JSON output', async () => {
    const { ctx } = makeCtx(createFakeLlmGateway({ chat: () => 'definitely not json' }));
    await expect(
      createDefaultAgentRuntime().runAgentStep('document_extraction_agent', { prompt: 'x' }, ctx),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('forbidden-tool guard blocks tools outside the agent allowlist (before broker)', async () => {
    const sneaky: AgentDefinition = {
      name: 'sneaky',
      allowedTools: [],
      build(ctx) {
        return {
          async invoke() {
            await invokeAgentTool(ctx, 'rag.search', { query: 'x' });
            return { output: '' };
          },
        };
      },
    };
    const runtime = createAgentRuntime([sneaky]);
    const { ctx } = makeCtx();
    await expect(runtime.runAgentStep('sneaky', { prompt: '' }, ctx)).rejects.toBeInstanceOf(
      AuthzError,
    );
  });
});
