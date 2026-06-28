import { describe, it, expect } from 'vitest';
import { createMockEmbeddingProvider } from './embeddingProvider.js';

describe('MockEmbeddingProvider', () => {
  it('produces vectors of the configured dimension', async () => {
    const p = createMockEmbeddingProvider({ dim: 768 });
    const [v] = await p.embed(['hello']);
    expect(v).toHaveLength(768);
    expect(p.dim).toBe(768);
    expect(p.providerId).toBe('mock');
  });

  it('is deterministic: same text → same vector', async () => {
    const p = createMockEmbeddingProvider({ dim: 768 });
    const [a] = await p.embed(['строительный акт']);
    const [b] = await p.embed(['строительный акт']);
    expect(a).toEqual(b);
  });

  it('different text → different vector', async () => {
    const p = createMockEmbeddingProvider({ dim: 768 });
    const [a] = await p.embed(['акт']);
    const [b] = await p.embed(['счёт']);
    expect(a).not.toEqual(b);
  });

  it('returns unit-length vectors (cosine-friendly)', async () => {
    const p = createMockEmbeddingProvider({ dim: 1536 });
    const [v] = await p.embed(['x']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('preserves input order and count', async () => {
    const p = createMockEmbeddingProvider();
    const out = await p.embed(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(out[0]).not.toEqual(out[1]);
  });

  it('rejects unsupported dimensions', () => {
    expect(() => createMockEmbeddingProvider({ dim: 1024 })).toThrow();
  });
});
