import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion, dedupePerDocument } from './fusionRrf.js';

describe('reciprocalRankFusion', () => {
  it('ranks an item appearing high in both lists first', () => {
    const vector = [{ chunkId: 'a' }, { chunkId: 'b' }, { chunkId: 'c' }];
    const lexical = [{ chunkId: 'a' }, { chunkId: 'd' }];
    const fused = reciprocalRankFusion([vector, lexical]);
    expect(fused[0].chunkId).toBe('a');
    expect(fused.map((f) => f.chunkId)).toContain('d');
  });

  it('is empty for empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});

describe('dedupePerDocument', () => {
  it('limits the number of chunks per document', () => {
    const items = [
      { chunkId: 'a1' },
      { chunkId: 'a2' },
      { chunkId: 'a3' },
      { chunkId: 'b1' },
    ];
    const docOf = (id: string) => id[0];
    const out = dedupePerDocument(items, docOf, 2);
    expect(out.map((i) => i.chunkId)).toEqual(['a1', 'a2', 'b1']);
  });
});
