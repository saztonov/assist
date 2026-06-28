import { describe, it, expect } from 'vitest';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { InMemoryAuditSink } from '@su10/audit';
import { AuthzError } from '@su10/errors';
import type { ToolContext } from '@su10/tools';
import { InMemoryRagRepository } from './ragRepository.js';
import { createRagService } from './ragService.js';
import { ragSearchTool } from './ragTool.js';

function setup() {
  const repo = new InMemoryRagRepository();
  repo.add(
    {
      chunkId: 'hr-1',
      documentId: 'd-hr',
      ownerUserId: 'u-1',
      title: 'HR',
      contentOriginal: 'политика по зарплата',
      contentEmbedding: 'политика по зарплата',
    },
    [1, 0, 0, 0],
  );
  const ragService = createRagService({
    repository: repo,
    embedder: { async embed(texts) { return texts.map(() => [1, 0, 0, 0]); } },
  });
  const registry = new ToolRegistry();
  registry.register(ragSearchTool({ ragService }));
  return new ToolBroker(registry);
}

function ctx(sub: string, roles: string[]): ToolContext {
  return { subject: { id: sub, roles }, auditSink: new InMemoryAuditSink(), at: '2026-01-01T00:00:00.000Z' };
}

describe('rag.search tool', () => {
  it('returns ACL-allowed chunks for the owner', async () => {
    const broker = setup();
    const out = (await broker.invoke('rag.search', { query: 'зарплата' }, ctx('u-1', ['rag.search', 'rag.read']))) as {
      chunks: Array<{ documentId: string }>;
    };
    expect(out.chunks.map((c) => c.documentId)).toContain('d-hr');
  });

  it('returns nothing for a subject without access (same ACL path)', async () => {
    const broker = setup();
    const out = (await broker.invoke('rag.search', { query: 'зарплата' }, ctx('u-2', ['rag.search', 'rag.read']))) as {
      chunks: unknown[];
    };
    expect(out.chunks).toHaveLength(0);
  });

  it('is denied for a subject lacking the required roles', async () => {
    const broker = setup();
    await expect(broker.invoke('rag.search', { query: 'x' }, ctx('u-3', []))).rejects.toBeInstanceOf(
      AuthzError,
    );
  });
});
