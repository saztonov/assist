/**
 * RAG query audit repository → `rag_queries`. NODE-ONLY.
 *
 * Stores METADATA + the ACL decision only: subject, scope, permission decision,
 * query HASH (never the raw query), result count, duration. `acl_scope` and
 * `permission_decision` are mandatory (they record ACL-before-retrieval).
 */
import { ragQueries } from '../schema/ragApp.js';
import type { Database } from '../index.js';

export interface RagQueryLogRow {
  subjectId: string;
  ragIndexId?: string;
  aclScope: string[];
  permissionDecision: string;
  queryHash?: string;
  profile?: string;
  resultCount?: number;
  durationMs?: number;
}

export interface RagQueryRepo {
  record(row: RagQueryLogRow): Promise<void>;
}

export function createRagQueryRepo(db: Database): RagQueryRepo {
  return {
    async record(row: RagQueryLogRow): Promise<void> {
      await db.insert(ragQueries).values({
        ...(row.ragIndexId ? { ragIndexId: row.ragIndexId } : {}),
        subjectId: row.subjectId,
        aclScope: row.aclScope,
        permissionDecision: row.permissionDecision,
        queryHash: row.queryHash ?? null,
        resultCount: row.resultCount ?? null,
        durationMs: row.durationMs ?? null,
        profile: row.profile ?? null,
      });
    },
  };
}

export class InMemoryRagQueryRepo implements RagQueryRepo {
  readonly rows: RagQueryLogRow[] = [];
  async record(row: RagQueryLogRow): Promise<void> {
    this.rows.push(row);
  }
}
