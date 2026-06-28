/**
 * Embedding abstraction. NODE-ONLY.
 *
 * Embeddings are produced by a DEDICATED provider, never by chat/vision models
 * (chandra/lift/qwen MUST NOT be used as embedders). The production provider is
 * selected by separate policy/config; until one is approved, only the
 * deterministic local `MockEmbeddingProvider` is available (tests/local dev).
 */
import { createHash } from 'node:crypto';

export interface EmbeddingProvider {
  /** Stable provider id stored alongside vectors (e.g. 'mock', 'lmstudio-embed'). */
  readonly providerId: string;
  /** Model id stored alongside vectors. */
  readonly model: string;
  /** Vector dimensionality (must match the target `rag.corpus_embeddings_{dim}`). */
  readonly dim: number;
  /** Returns one vector per input text, in order. */
  embed(texts: string[]): Promise<number[][]>;
}

export interface MockEmbeddingOptions {
  dim?: number;
  providerId?: string;
  model?: string;
}

/**
 * Deterministic, dependency-free embedding provider for tests and local dev.
 * Same text → same unit-length vector (good for cosine distance). NOT for prod.
 */
export function createMockEmbeddingProvider(opts: MockEmbeddingOptions = {}): EmbeddingProvider {
  const dim = opts.dim ?? 768;
  if (dim !== 768 && dim !== 1536) {
    throw new Error(`MockEmbeddingProvider: unsupported dim ${dim} (expected 768 or 1536)`);
  }
  const providerId = opts.providerId ?? 'mock';
  const model = opts.model ?? 'mock-embed';
  return {
    providerId,
    model,
    dim,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => embedOne(t, dim));
    },
  };
}

/** seeded xorshift32 → deterministic pseudo-random uint32 stream. */
function makePrng(seed: Buffer): () => number {
  let x = (seed.readUInt32LE(0) ^ 0x9e3779b9) >>> 0;
  if (x === 0) x = 0x1a2b3c4d;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

function embedOne(text: string, dim: number): number[] {
  const seed = createHash('sha256').update(text, 'utf8').digest();
  const next = makePrng(seed);
  const v = new Array<number>(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const r = (next() / 0xffffffff) * 2 - 1; // [-1, 1)
    v[i] = r;
    norm += r * r;
  }
  const inv = norm > 0 ? 1 / Math.sqrt(norm) : 1;
  for (let i = 0; i < dim; i++) v[i] *= inv;
  return v;
}
