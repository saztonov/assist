import { describe, it, expect } from 'vitest';
import { InMemoryDocumentRepo, InMemoryRagChunkRepo } from '@su10/db';
import { createMockEmbeddingProvider } from '@su10/llm';
import { processDocument, normalizeText, type DocumentWorkerDeps, type OcrPort } from './index.js';

const text = Array.from({ length: 60 }, (_, i) => `слово${i}`).join(' ');

async function seedDocument(
  documentRepo: InMemoryDocumentRepo,
  opts: { mimeType?: string } = {},
) {
  const { document, version } = await documentRepo.createUploadSession({
    ownerUserId: 'u-1',
    createdBy: 'u-1',
    filename: 'doc.md',
    mimeType: opts.mimeType ?? 'text/markdown',
    storageKey: 'documents/x/doc.md',
    title: 'Тестовый документ',
    documentType: 'note',
  });
  await documentRepo.confirmUpload({ documentId: document.id, documentVersionId: version.id });
  return { documentId: document.id, documentVersionId: version.id };
}

function makeDeps(over: Partial<DocumentWorkerDeps> = {}): {
  deps: DocumentWorkerDeps;
  documentRepo: InMemoryDocumentRepo;
  chunkRepo: InMemoryRagChunkRepo;
} {
  const documentRepo = new InMemoryDocumentRepo();
  const chunkRepo = new InMemoryRagChunkRepo();
  const deps: DocumentWorkerDeps = {
    documentRepo,
    chunkRepo,
    embeddingProvider: createMockEmbeddingProvider({ dim: 768 }),
    storage: { getObjectBytes: async () => Buffer.from(text, 'utf-8') },
    ...over,
  };
  return { deps, documentRepo, chunkRepo };
}

describe('normalizeText', () => {
  it('collapses blank lines and trailing whitespace', () => {
    expect(normalizeText('a  \n\n\n\nb  ')).toBe('a\n\nb');
  });
});

describe('processDocument', () => {
  it('indexes a text document into chunks + embeddings', async () => {
    const { deps, documentRepo, chunkRepo } = makeDeps();
    const job = await seedDocument(documentRepo);
    const res = await processDocument(job, deps);
    expect(res.status).toBe('indexed');
    expect(res.chunkCount).toBeGreaterThan(0);
    expect(chunkRepo.chunks.length).toBe(res.chunkCount);
    expect((await documentRepo.getDocumentById(job.documentId))?.status).toBe('indexed');
    // Embeddings stored alongside chunks.
    expect(chunkRepo.chunks[0].embedding).toHaveLength(768);
  });

  it('is idempotent: re-processing inserts no new chunks', async () => {
    const { deps, documentRepo, chunkRepo } = makeDeps();
    const job = await seedDocument(documentRepo);
    const first = await processDocument(job, deps);
    const before = chunkRepo.chunks.length;
    const second = await processDocument(job, deps);
    expect(second.chunkCount).toBe(first.chunkCount);
    expect(second.insertedCount).toBe(0);
    expect(chunkRepo.chunks.length).toBe(before);
  });

  it('records a safe error code and marks failed when fetching bytes fails', async () => {
    const { deps, documentRepo } = makeDeps({
      storage: {
        getObjectBytes: async () => {
          throw new Error('s3 down: presigned https://secret');
        },
      },
    });
    const job = await seedDocument(documentRepo);
    const res = await processDocument(job, deps);
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('INDEXING_FAILED');
    expect(res.errorCode).not.toContain('secret');
    expect((await documentRepo.getDocumentById(job.documentId))?.status).toBe('failed');
  });

  it('fails closed on an unsupported binary format', async () => {
    const { deps, documentRepo } = makeDeps({
      storage: { getObjectBytes: async () => new Uint8Array([0, 1, 2]) },
    });
    const job = await seedDocument(documentRepo, { mimeType: 'application/pdf' });
    const res = await processDocument(job, deps);
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('UNSUPPORTED_FORMAT');
  });

  it('uses the OCR port for images', async () => {
    const ocr: OcrPort = { ocrImageToMarkdown: async () => 'распознанный текст акта' };
    const { deps, documentRepo, chunkRepo } = makeDeps({
      ocr,
      storage: { getObjectBytes: async () => new Uint8Array([1, 2, 3]) },
    });
    const job = await seedDocument(documentRepo, { mimeType: 'image/png' });
    const res = await processDocument(job, deps);
    expect(res.status).toBe('indexed');
    expect(chunkRepo.chunks[0].contentOriginal).toContain('распознанный текст');
  });
});
