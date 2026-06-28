import { describe, it, expect } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { aclWhere, createPgRagRepository, type RagSqlExecutor } from './ragRepository.pg.js';
import { buildAclPredicate } from './aclPredicate.js';

function fakeDb(rowsByCall: Record<string, unknown>[][]): RagSqlExecutor & { calls: SQL[] } {
  const calls: SQL[] = [];
  return {
    calls,
    async execute(q: SQL) {
      calls.push(q);
      return { rows: rowsByCall.shift() ?? [] };
    },
  };
}

const adminPredicate = buildAclPredicate({
  subject: { id: 'a', roles: ['admin'] },
  permission: { allowed: true },
});

describe('aclWhere', () => {
  it('builds a SQL condition for admin (no owner restriction)', () => {
    expect(aclWhere(adminPredicate)).toBeTruthy();
  });

  it('builds owner/department/project conditions for non-admin', () => {
    const p = buildAclPredicate({
      subject: { id: 'u', roles: [] },
      permission: { allowed: true },
      allowedDepartments: ['hr'],
      allowedProjects: ['p1'],
    });
    expect(aclWhere(p)).toBeTruthy();
  });
});

describe('createPgRagRepository (row mapping)', () => {
  it('maps vector search rows to candidates', async () => {
    const db = fakeDb([[{ chunk_id: 'c1', score: 0.9 }]]);
    const repo = createPgRagRepository(db, { embeddingDim: 768 });
    const out = await repo.vectorSearch(adminPredicate, [0.1, 0.2], 5);
    expect(out).toEqual([{ chunkId: 'c1', score: 0.9 }]);
    expect(db.calls).toHaveLength(1);
  });

  it('maps hydrate rows to records', async () => {
    const db = fakeDb([
      [
        {
          chunk_id: 'c1',
          document_id: 'd1',
          owner_user_id: 'u',
          content_original: 'x',
          content_embedding: 'x',
          title: 'T',
          page_from: 1,
          page_to: 2,
        },
      ],
    ]);
    const repo = createPgRagRepository(db);
    const out = await repo.hydrate(adminPredicate, ['c1']);
    expect(out[0]).toMatchObject({ chunkId: 'c1', documentId: 'd1', title: 'T', pageFrom: 1, pageTo: 2 });
  });

  it('skips the query for an empty hydrate id list', async () => {
    const db = fakeDb([]);
    const repo = createPgRagRepository(db);
    expect(await repo.hydrate(adminPredicate, [])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});
