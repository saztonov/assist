/**
 * RAG retrieval repository port. NODE-ONLY.
 *
 * Every method takes the `AclPredicate` and MUST apply it INSIDE candidate
 * selection/hydration (ACL-before-retrieval) — never return a chunk the subject
 * may not see. The in-memory implementation here is the test/contract reference;
 * the pgvector implementation (`ragRepository.pg.ts`) mirrors its semantics.
 */
import {
  chunkMatchesPredicate,
  type AclPredicate,
} from './aclPredicate.js';

export interface RagChunkRecord {
  chunkId: string;
  documentId: string;
  ownerUserId?: string | null;
  departmentId?: string | null;
  projectId?: string | null;
  documentType?: string | null;
  securityLevel?: string | null;
  title?: string | null;
  pageFrom?: number | null;
  pageTo?: number | null;
  contentOriginal: string;
  contentEmbedding: string;
}

export interface Candidate {
  chunkId: string;
  score: number;
}

export interface RagRepository {
  vectorSearch(predicate: AclPredicate, queryVector: number[], k: number): Promise<Candidate[]>;
  lexicalSearch(predicate: AclPredicate, queryText: string, k: number): Promise<Candidate[]>;
  hydrate(predicate: AclPredicate, chunkIds: string[]): Promise<RagChunkRecord[]>;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function lexicalScore(query: string, content: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const hay = content.toLowerCase();
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits++;
  return hits / terms.length;
}

/** In-memory RAG repository (tests). ACL predicate filters BEFORE scoring. */
export class InMemoryRagRepository implements RagRepository {
  private readonly chunks = new Map<string, RagChunkRecord>();
  private readonly vectors = new Map<string, number[]>();

  add(record: RagChunkRecord, vector: number[]): void {
    this.chunks.set(record.chunkId, record);
    this.vectors.set(record.chunkId, vector);
  }

  private visible(predicate: AclPredicate): RagChunkRecord[] {
    return [...this.chunks.values()].filter((c) => chunkMatchesPredicate(c, predicate));
  }

  async vectorSearch(predicate: AclPredicate, queryVector: number[], k: number): Promise<Candidate[]> {
    return this.visible(predicate)
      .map((c) => ({ chunkId: c.chunkId, score: cosine(queryVector, this.vectors.get(c.chunkId) ?? []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async lexicalSearch(predicate: AclPredicate, queryText: string, k: number): Promise<Candidate[]> {
    return this.visible(predicate)
      .map((c) => ({ chunkId: c.chunkId, score: lexicalScore(queryText, c.contentOriginal) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async hydrate(predicate: AclPredicate, chunkIds: string[]): Promise<RagChunkRecord[]> {
    const out: RagChunkRecord[] = [];
    for (const id of chunkIds) {
      const c = this.chunks.get(id);
      if (c && chunkMatchesPredicate(c, predicate)) out.push(c);
    }
    return out;
  }
}
