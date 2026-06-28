import { describe, it, expect } from 'vitest';
import { chunkDocument, CHUNKER_VERSION } from './chunker.js';

const longText = Array.from({ length: 120 }, (_, i) => `слово${i}`).join(' ');

describe('chunkDocument', () => {
  it('returns no chunks for empty input', () => {
    expect(chunkDocument({ text: '' })).toEqual([]);
    expect(chunkDocument({ text: '   ' })).toEqual([]);
  });

  it('produces stable hashes for identical input', () => {
    const a = chunkDocument({ text: longText }, { maxTokens: 20, overlapTokens: 5 });
    const b = chunkDocument({ text: longText }, { maxTokens: 20, overlapTokens: 5 });
    expect(a.map((c) => c.chunkHash)).toEqual(b.map((c) => c.chunkHash));
    expect(a[0].sourceTextHash).toBe(b[0].sourceTextHash);
    expect(a[0].chunkerVersion).toBe(CHUNKER_VERSION);
  });

  it('splits long text into multiple overlapping chunks', () => {
    const chunks = chunkDocument({ text: longText }, { maxTokens: 20, overlapTokens: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: the next chunk starts before the previous one ends (char space).
    expect(chunks[1].charStart).toBeLessThan(chunks[0].charEnd);
    expect(chunks[0].tokenCount).toBeLessThanOrEqual(20);
  });

  it('keeps content_original raw and enriches content_embedding with metadata', () => {
    const [chunk] = chunkDocument(
      { text: 'короткий текст', title: 'Акт №5', documentType: 'act' },
      { maxTokens: 50 },
    );
    expect(chunk.contentOriginal).toBe('короткий текст');
    expect(chunk.contentEmbedding).toContain('Заголовок: Акт №5');
    expect(chunk.contentEmbedding).toContain('короткий текст');
    expect(chunk.contentOriginal).not.toContain('Заголовок');
  });

  it('maps char ranges to page ranges', () => {
    const text = 'aaa bbb ccc ddd eee';
    const pages = [
      { page: 1, charStart: 0, charEnd: 7 },
      { page: 2, charStart: 7, charEnd: 19 },
    ];
    const chunks = chunkDocument({ text, pages }, { maxTokens: 2, overlapTokens: 0 });
    expect(chunks[0].pageFrom).toBe(1);
    expect(chunks.at(-1)?.pageTo).toBe(2);
  });

  it('indexes chunks sequentially from 0', () => {
    const chunks = chunkDocument({ text: longText }, { maxTokens: 30, overlapTokens: 5 });
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });
});
