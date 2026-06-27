import { describe, it, expect } from 'vitest';
import { processDocument } from './index.js';

describe('document-worker', () => {
  it('is idempotent: re-processing the same document is skipped', async () => {
    const job = { documentId: 'doc-1', contentHash: 'abc' };
    const first = await processDocument(job);
    const second = await processDocument(job);
    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
