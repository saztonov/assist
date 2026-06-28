/**
 * RAG chunk/embedding write repository → schema `rag`. NODE-ONLY.
 *
 * Idempotent by the natural key (document_version_id, source_text_hash,
 * chunker_version, chunk_index) — re-indexing the same content does not duplicate
 * chunks. Embeddings upsert by (chunk_id, provider, model). Also records index
 * run telemetry. The in-memory variant backs the document-worker unit tests.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../index.js';

export interface RagChunkUpsertInput {
  documentId: string;
  documentVersionId: string;
  sourceObjectType?: string | null;
  sourceObjectId?: string | null;
  projectId?: string | null;
  departmentId?: string | null;
  ownerUserId?: string | null;
  documentType?: string | null;
  securityLevel?: string | null;
  title?: string | null;
  pageFrom?: number | null;
  pageTo?: number | null;
  chunkIndex: number;
  tokenCount: number;
  charStart?: number | null;
  charEnd?: number | null;
  contentOriginal: string;
  contentEmbedding: string;
  sourceTextHash: string;
  chunkHash: string;
  chunkerVersion: string;
  metadata?: Record<string, unknown> | null;
  embedding: number[];
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDim: 768 | 1536;
}

export interface IndexRunStartInput {
  backend: string;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
  sourceCount?: number;
}

export interface IndexRunFinishInput {
  status: 'completed' | 'failed';
  chunkCount?: number;
  tokenCount?: number;
  successCount?: number;
  errorCount?: number;
  errorText?: string | null;
}

export interface RagChunkRepo {
  upsertChunk(input: RagChunkUpsertInput): Promise<{ chunkId: string; inserted: boolean }>;
  startIndexRun(input: IndexRunStartInput): Promise<{ id: string }>;
  finishIndexRun(id: string, input: IndexRunFinishInput): Promise<void>;
}

function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export function createRagChunkRepo(db: Database): RagChunkRepo {
  return {
    async upsertChunk(input) {
      const embTable =
        input.embeddingDim === 1536
          ? sql.raw('rag.corpus_embeddings_1536')
          : sql.raw('rag.corpus_embeddings_768');
      // Upsert the chunk by its natural key; RETURNING yields the id either way.
      const chunkRes = await db.execute(sql`
        INSERT INTO rag.corpus_chunks (
          document_id, document_version_id, source_object_type, source_object_id,
          project_id, department_id, owner_user_id, document_type, security_level, title,
          page_from, page_to, chunk_index, token_count, char_start, char_end,
          content_original, content_embedding, source_text_hash, chunk_hash, chunker_version, metadata_json
        ) VALUES (
          ${input.documentId}, ${input.documentVersionId}, ${input.sourceObjectType ?? null}, ${input.sourceObjectId ?? null},
          ${input.projectId ?? null}, ${input.departmentId ?? null}, ${input.ownerUserId ?? null}, ${input.documentType ?? null},
          ${input.securityLevel ?? null}, ${input.title ?? null}, ${input.pageFrom ?? null}, ${input.pageTo ?? null},
          ${input.chunkIndex}, ${input.tokenCount}, ${input.charStart ?? null}, ${input.charEnd ?? null},
          ${input.contentOriginal}, ${input.contentEmbedding}, ${input.sourceTextHash}, ${input.chunkHash},
          ${input.chunkerVersion}, ${input.metadata ?? null}
        )
        ON CONFLICT (document_version_id, source_text_hash, chunker_version, chunk_index)
        DO UPDATE SET content_original = EXCLUDED.content_original
        RETURNING chunk_id, (xmax = 0) AS inserted`);
      const row = chunkRes.rows[0] as { chunk_id: string; inserted: boolean };
      const chunkId = String(row.chunk_id);

      await db.execute(sql`
        INSERT INTO ${embTable} (chunk_id, provider, model, embedding, model_version, embedding_dim)
        VALUES (${chunkId}, ${input.embeddingProvider}, ${input.embeddingModel},
                ${vectorLiteral(input.embedding)}::vector, ${input.embeddingModel}, ${input.embeddingDim})
        ON CONFLICT (chunk_id, provider, model)
        DO UPDATE SET embedding = EXCLUDED.embedding`);

      return { chunkId, inserted: Boolean(row.inserted) };
    },

    async startIndexRun(input) {
      const res = await db.execute(sql`
        INSERT INTO rag.index_runs (backend, status, source_count, embedding_provider, embedding_model, embedding_dim)
        VALUES (${input.backend}, 'running', ${input.sourceCount ?? 0},
                ${input.embeddingProvider ?? null}, ${input.embeddingModel ?? null}, ${input.embeddingDim ?? null})
        RETURNING id`);
      return { id: String((res.rows[0] as { id: string }).id) };
    },

    async finishIndexRun(id, input) {
      await db.execute(sql`
        UPDATE rag.index_runs
        SET status = ${input.status},
            chunk_count = ${input.chunkCount ?? 0},
            token_count = ${input.tokenCount ?? 0},
            success_count = ${input.successCount ?? 0},
            error_count = ${input.errorCount ?? 0},
            error_text = ${input.errorText ?? null},
            completed_at = now()
        WHERE id = ${id}`);
    },
  };
}

// ── In-memory implementation (document-worker tests) ─────────────────────────

export class InMemoryRagChunkRepo implements RagChunkRepo {
  readonly chunks: Array<{ chunkId: string } & RagChunkUpsertInput> = [];
  readonly indexRuns: Array<{ id: string; status: string } & IndexRunStartInput> = [];
  private seq = 0;

  private key(i: RagChunkUpsertInput): string {
    return `${i.documentVersionId}|${i.sourceTextHash}|${i.chunkerVersion}|${i.chunkIndex}`;
  }

  async upsertChunk(input: RagChunkUpsertInput) {
    const key = this.key(input);
    const existing = this.chunks.find((c) => this.key(c) === key);
    if (existing) {
      Object.assign(existing, input);
      return { chunkId: existing.chunkId, inserted: false };
    }
    const chunkId = `chunk-${this.seq++}`;
    this.chunks.push({ chunkId, ...input });
    return { chunkId, inserted: true };
  }

  async startIndexRun(input: IndexRunStartInput) {
    const id = `run-${this.seq++}`;
    this.indexRuns.push({ id, status: 'running', ...input });
    return { id };
  }

  async finishIndexRun(id: string, input: IndexRunFinishInput) {
    const run = this.indexRuns.find((r) => r.id === id);
    if (run) run.status = input.status;
  }
}
