/**
 * RAG search service. NODE-ONLY.
 *
 * ACL-before-retrieval (fail-closed): build the ACL predicate first, then embed →
 * vector+lexical candidates (predicate applied in the repository) → RRF → per-doc
 * dedup → hydrate (predicate re-applied) → optional rerank → citations + timings.
 * Logs `rag_queries` METADATA only (scope, hash, counts) — never the raw query
 * or chunk content.
 */
import { buildAclPredicate, deriveScopeTags, type ExecutionContext } from './aclPredicate.js';
import { buildRagQuery, type RagQueryRow } from './ragQuery.js';
import {
  reciprocalRankFusion,
  dedupePerDocument,
  type FusedItem,
} from './fusionRrf.js';
import { identityReranker, type Reranker } from './rerank.js';
import type { RagChunkRecord, RagRepository } from './ragRepository.js';

export interface RagEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface RagQueryLogInput extends RagQueryRow {
  resultCount: number;
  durationMs: number;
  backend: string;
}

export interface RagQueryLogPort {
  record(input: RagQueryLogInput): Promise<void>;
}

export interface RagServiceDeps {
  repository: RagRepository;
  embedder: RagEmbedder;
  reranker?: Reranker;
  queryLog?: RagQueryLogPort;
  backend?: string;
  now?: () => number;
}

export interface RagSearchRequest {
  query: string;
  context: ExecutionContext;
  k?: number;
  profile?: string;
  ragIndexId?: string;
}

export interface Citation {
  documentId: string;
  chunkId: string;
  pageFrom?: number | null;
  pageTo?: number | null;
  title?: string | null;
}

export interface RagSearchChunk {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  citation: Citation;
}

export interface RagTimings {
  embeddingMs: number;
  vectorMs: number;
  lexicalMs: number;
  fusionMs: number;
  hydrationMs: number;
  rerankMs: number;
  totalMs: number;
}

export interface RagSearchResult {
  chunks: RagSearchChunk[];
  citations: Citation[];
  timings: RagTimings;
  backend: string;
}

function citationOf(c: RagChunkRecord): Citation {
  return {
    documentId: c.documentId,
    chunkId: c.chunkId,
    pageFrom: c.pageFrom ?? null,
    pageTo: c.pageTo ?? null,
    title: c.title ?? null,
  };
}

export interface RagService {
  search(req: RagSearchRequest): Promise<RagSearchResult>;
}

export function createRagService(deps: RagServiceDeps): RagService {
  const reranker: Reranker = deps.reranker ?? identityReranker;
  const backend = deps.backend ?? 'pgvector';
  const now = deps.now ?? (() => Date.now());

  return {
    async search(req: RagSearchRequest): Promise<RagSearchResult> {
      const t0 = now();
      const k = req.k ?? 8;

      // 1) ACL-before-retrieval (fail-closed). Also build the safe audit row.
      const predicate = buildAclPredicate(req.context);
      const queryRow = buildRagQuery({
        subjectId: req.context.subject.id,
        query: req.query,
        aclScope: deriveScopeTags(req.context),
        permissionDecision: req.context.permission,
        ...(req.ragIndexId ? { ragIndexId: req.ragIndexId } : {}),
        ...(req.profile ? { profile: req.profile } : {}),
      });

      // 2) Embed the query.
      const tEmbed = now();
      const [queryVector] = await deps.embedder.embed([req.query]);
      const embeddingMs = now() - tEmbed;

      // 3) Vector + lexical candidates (ACL predicate applied in the repository).
      const tVec = now();
      const vector = await deps.repository.vectorSearch(predicate, queryVector ?? [], k);
      const vectorMs = now() - tVec;

      const tLex = now();
      const lexical = await deps.repository.lexicalSearch(predicate, req.query, k);
      const lexicalMs = now() - tLex;

      // 4) Fuse + dedup per document.
      const tFuse = now();
      const fused: FusedItem[] = reciprocalRankFusion([vector, lexical]);
      const fusionMs = now() - tFuse;

      // 5) Hydrate (predicate re-applied) preserving fused order.
      const tHyd = now();
      const topIds = fused.slice(0, k * 3).map((f) => f.chunkId);
      const hydrated = await deps.repository.hydrate(predicate, topIds);
      const byId = new Map(hydrated.map((h) => [h.chunkId, h]));
      const docOf = (id: string): string | undefined => byId.get(id)?.documentId;
      const ordered = fused.filter((f) => byId.has(f.chunkId));
      const deduped = dedupePerDocument(ordered, docOf).slice(0, k);
      const hydrationMs = now() - tHyd;

      // 6) Optional rerank.
      const tRr = now();
      const reranked = await reranker.rerank(
        req.query,
        deduped.map((f) => ({
          chunkId: f.chunkId,
          content: byId.get(f.chunkId)?.contentOriginal ?? '',
          score: f.score,
        })),
      );
      const rerankMs = now() - tRr;

      const chunks: RagSearchChunk[] = reranked.map((item) => {
        const rec = byId.get(item.chunkId)!;
        return {
          chunkId: rec.chunkId,
          documentId: rec.documentId,
          content: rec.contentOriginal,
          score: item.score,
          citation: citationOf(rec),
        };
      });

      const totalMs = now() - t0;
      const timings: RagTimings = {
        embeddingMs,
        vectorMs,
        lexicalMs,
        fusionMs,
        hydrationMs,
        rerankMs,
        totalMs,
      };

      // 7) Audit (metadata only). Failure to log must not fail the search.
      if (deps.queryLog) {
        try {
          await deps.queryLog.record({ ...queryRow, resultCount: chunks.length, durationMs: totalMs, backend });
        } catch {
          /* swallow logging errors */
        }
      }

      return { chunks, citations: chunks.map((c) => c.citation), timings, backend };
    },
  };
}
