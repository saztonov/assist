/**
 * pgvector implementation of `RagRepository`. NODE-ONLY.
 *
 * The ACL predicate is compiled into the SQL WHERE clause of EVERY query
 * (vector/lexical/hydrate) — candidates a subject may not see are never selected
 * or scored (ACL-before-retrieval). Distance operator `<=>` and FTS require the
 * `vector` / `pg_trgm` extensions (provisioned by an admin migration step).
 *
 * Note: exact correctness needs a live pgvector DB (covered by integration tests
 * later); unit tests here cover ACL SQL construction and row mapping with a fake
 * executor. The in-memory repository is the behavioral reference.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AclPredicate } from './aclPredicate.js';
import type { Candidate, RagChunkRecord, RagRepository } from './ragRepository.js';

/** Narrow executor so a fake can be used in unit tests (real `Database` fits). */
export interface RagSqlExecutor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PgRagRepositoryOptions {
  embeddingDim?: 768 | 1536;
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

/** Compiles the ACL predicate into a SQL boolean over `rag.corpus_chunks c`. */
export function aclWhere(p: AclPredicate): SQL {
  const conds: SQL[] = [];
  if (!p.isAdmin) {
    conds.push(
      sql`(c.owner_user_id = ${p.subjectId} OR c.department_id = ANY(${p.allowedDepartments}) OR c.project_id = ANY(${p.allowedProjects}))`,
    );
  }
  if (p.restrictDocumentIds) conds.push(sql`c.document_id = ANY(${p.restrictDocumentIds})`);
  if (p.restrictProjectId) conds.push(sql`c.project_id = ${p.restrictProjectId}`);
  if (p.restrictDepartmentId) conds.push(sql`c.department_id = ${p.restrictDepartmentId}`);
  if (conds.length === 0) return sql`TRUE`;
  return sql.join(conds, sql` AND `);
}

function mapRecord(r: Record<string, unknown>): RagChunkRecord {
  return {
    chunkId: String(r.chunk_id),
    documentId: String(r.document_id),
    ownerUserId: (r.owner_user_id as string | null) ?? null,
    departmentId: (r.department_id as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    documentType: (r.document_type as string | null) ?? null,
    securityLevel: (r.security_level as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    pageFrom: (r.page_from as number | null) ?? null,
    pageTo: (r.page_to as number | null) ?? null,
    contentOriginal: String(r.content_original ?? ''),
    contentEmbedding: String(r.content_embedding ?? ''),
  };
}

export function createPgRagRepository(
  db: RagSqlExecutor,
  opts: PgRagRepositoryOptions = {},
): RagRepository {
  const dim = opts.embeddingDim ?? 768;
  const embTable = dim === 1536 ? sql.raw('rag.corpus_embeddings_1536') : sql.raw('rag.corpus_embeddings_768');

  return {
    async vectorSearch(predicate, queryVector, k): Promise<Candidate[]> {
      const vec = vectorLiteral(queryVector);
      const q = sql`
        SELECT e.chunk_id AS chunk_id, 1 - (e.embedding <=> ${vec}::vector) AS score
        FROM ${embTable} e
        JOIN rag.corpus_chunks c ON c.chunk_id = e.chunk_id
        WHERE ${aclWhere(predicate)}
        ORDER BY e.embedding <=> ${vec}::vector ASC
        LIMIT ${k}`;
      const res = await db.execute(q);
      return res.rows.map((r) => ({ chunkId: String(r.chunk_id), score: Number(r.score) }));
    },

    async lexicalSearch(predicate, queryText, k): Promise<Candidate[]> {
      const q = sql`
        SELECT c.chunk_id AS chunk_id,
               ts_rank(c.search_vector, plainto_tsquery('russian', ${queryText})) AS score
        FROM rag.corpus_chunks c
        WHERE c.search_vector @@ plainto_tsquery('russian', ${queryText})
          AND ${aclWhere(predicate)}
        ORDER BY score DESC
        LIMIT ${k}`;
      const res = await db.execute(q);
      return res.rows.map((r) => ({ chunkId: String(r.chunk_id), score: Number(r.score) }));
    },

    async hydrate(predicate, chunkIds): Promise<RagChunkRecord[]> {
      if (chunkIds.length === 0) return [];
      const q = sql`
        SELECT c.chunk_id, c.document_id, c.owner_user_id, c.department_id, c.project_id,
               c.document_type, c.security_level, c.title, c.page_from, c.page_to,
               c.content_original, c.content_embedding
        FROM rag.corpus_chunks c
        WHERE c.chunk_id = ANY(${chunkIds}) AND ${aclWhere(predicate)}`;
      const res = await db.execute(q);
      return res.rows.map(mapRecord);
    },
  };
}
