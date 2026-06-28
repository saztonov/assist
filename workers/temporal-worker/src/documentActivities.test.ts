import { describe, it, expect } from 'vitest';
import { InMemoryDocumentRepo, InMemoryRagChunkRepo } from '@su10/db';
import { createMockEmbeddingProvider } from '@su10/llm';
import type { DocumentWorkerDeps } from '@su10/document-worker';
import { createDocumentActivities } from './documentActivities.js';

const text = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ');

async function seed(documentRepo: InMemoryDocumentRepo, mimeType = 'text/markdown') {
  const { document, version } = await documentRepo.createUploadSession({
    ownerUserId: 'u-1',
    createdBy: 'u-1',
    filename: 'd.md',
    mimeType,
    storageKey: 'k',
  });
  await documentRepo.confirmUpload({ documentId: document.id, documentVersionId: version.id });
  return { documentId: document.id, documentVersionId: version.id };
}

function deps(over: Partial<DocumentWorkerDeps> = {}): {
  deps: DocumentWorkerDeps;
  documentRepo: InMemoryDocumentRepo;
} {
  const documentRepo = new InMemoryDocumentRepo();
  return {
    documentRepo,
    deps: {
      documentRepo,
      chunkRepo: new InMemoryRagChunkRepo(),
      embeddingProvider: createMockEmbeddingProvider({ dim: 768 }),
      storage: { getObjectBytes: async () => Buffer.from(text, 'utf-8') },
      ...over,
    },
  };
}

describe('createDocumentActivities', () => {
  it('returns indexed for a valid text document', async () => {
    const { deps: d, documentRepo } = deps();
    const job = await seed(documentRepo);
    const acts = createDocumentActivities(d);
    const res = await acts.processDocument({ ...job, subjectId: 'u-1', roles: [] });
    expect(res.status).toBe('indexed');
    expect(res.chunkCount).toBeGreaterThan(0);
  });

  it('throws on transient failure so Temporal retries', async () => {
    const { deps: d, documentRepo } = deps({
      storage: {
        getObjectBytes: async () => {
          throw new Error('s3 down');
        },
      },
    });
    const job = await seed(documentRepo);
    const acts = createDocumentActivities(d);
    await expect(acts.processDocument({ ...job, subjectId: 'u-1', roles: [] })).rejects.toThrow();
  });

  it('returns failed (no throw) for a permanent unsupported format', async () => {
    const { deps: d, documentRepo } = deps({
      storage: { getObjectBytes: async () => new Uint8Array([0, 1]) },
    });
    const job = await seed(documentRepo, 'application/pdf');
    const acts = createDocumentActivities(d);
    const res = await acts.processDocument({ ...job, subjectId: 'u-1', roles: [] });
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('UNSUPPORTED_FORMAT');
  });
});
