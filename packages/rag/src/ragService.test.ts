import { describe, it, expect } from 'vitest';
import { AuthzError } from '@su10/errors';
import { InMemoryRagRepository } from './ragRepository.js';
import { createRagService, type RagEmbedder, type RagQueryLogPort, type RagQueryLogInput } from './ragService.js';
import type { ExecutionContext } from './aclPredicate.js';

const embedder: RagEmbedder = { async embed(texts) { return texts.map(() => [1, 0, 0, 0]); } };

class FakeQueryLog implements RagQueryLogPort {
  readonly rows: RagQueryLogInput[] = [];
  async record(input: RagQueryLogInput): Promise<void> {
    this.rows.push(input);
  }
}

function makeRepo(): InMemoryRagRepository {
  const repo = new InMemoryRagRepository();
  repo.add(
    {
      chunkId: 'hr-1',
      documentId: 'd-hr',
      ownerUserId: 'u-1',
      departmentId: 'hr',
      title: 'HR doc',
      contentOriginal: 'политика по зарплата сотрудников',
      contentEmbedding: 'политика по зарплата сотрудников',
    },
    [1, 0, 0, 0],
  );
  repo.add(
    {
      chunkId: 'legal-1',
      documentId: 'd-legal',
      ownerUserId: 'u-2',
      departmentId: 'legal',
      title: 'Legal',
      contentOriginal: 'договор аренды помещения',
      contentEmbedding: 'договор аренды помещения',
    },
    [0, 1, 0, 0],
  );
  return repo;
}

const userCtx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  subject: { id: 'u-1', roles: [] },
  permission: { allowed: true },
  allowedDepartments: ['hr'],
  allowedProjects: [],
  scope: { mode: 'all_allowed' },
  ...over,
});

describe('ragService.search — ACL before retrieval', () => {
  it('never returns chunks from documents the subject cannot see', async () => {
    const queryLog = new FakeQueryLog();
    const svc = createRagService({ repository: makeRepo(), embedder, queryLog });
    const res = await svc.search({ query: 'зарплата', context: userCtx() });
    const docs = res.chunks.map((c) => c.documentId);
    expect(docs).toContain('d-hr');
    expect(docs).not.toContain('d-legal');
  });

  it('returns citations and stage timings', async () => {
    const svc = createRagService({ repository: makeRepo(), embedder });
    const res = await svc.search({ query: 'зарплата', context: userCtx() });
    expect(res.chunks[0].citation).toMatchObject({ documentId: 'd-hr', title: 'HR doc' });
    expect(res.citations.length).toBe(res.chunks.length);
    expect(typeof res.timings.totalMs).toBe('number');
    expect(res.timings).toHaveProperty('vectorMs');
    expect(res.timings).toHaveProperty('lexicalMs');
    expect(res.timings).toHaveProperty('fusionMs');
  });

  it('fails closed when the permission decision is not allowed', async () => {
    const svc = createRagService({ repository: makeRepo(), embedder });
    await expect(
      svc.search({ query: 'зарплата', context: userCtx({ permission: { allowed: false } }) }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it('logs rag_queries metadata only (hash, not the raw query)', async () => {
    const queryLog = new FakeQueryLog();
    const svc = createRagService({ repository: makeRepo(), embedder, queryLog });
    await svc.search({ query: 'зарплата', context: userCtx(), profile: 'default' });
    const row = queryLog.rows[0];
    expect(row.permissionDecision).toBe('allowed');
    expect(row.aclScope.length).toBeGreaterThan(0);
    expect(row.queryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain('зарплата');
  });

  it('admin sees chunks across departments', async () => {
    const svc = createRagService({ repository: makeRepo(), embedder });
    const res = await svc.search({
      query: 'договор',
      context: userCtx({ subject: { id: 'a', roles: ['admin'] } }),
    });
    const docs = res.chunks.map((c) => c.documentId);
    expect(docs).toContain('d-hr');
    expect(docs).toContain('d-legal');
  });
});
