/**
 * Document indexing pipeline. NODE-ONLY.
 *
 * Pure, dependency-injected stages: fetch bytes → parse/OCR → normalize → chunk →
 * embed → store (idempotent) + index-run telemetry. All side effects go through
 * injected ports, so unit tests run fully on mocks/stubs (no S3/LM Studio/DB).
 * Idempotent by `source_text_hash`/`chunk_hash`/`chunker_version`. Raw document
 * bytes/text are never logged or placed in errors.
 */
import { createLogger } from '@su10/logger';
import { chunkDocument, type Chunk, type PageSpan } from '@su10/rag';
import type { DocumentRepo, RagChunkRepo } from '@su10/db';
import type { EmbeddingProvider } from '@su10/llm';

const log = createLogger('document-worker');

export interface DocumentJob {
  documentId: string;
  documentVersionId: string;
}

/** Subset of the S3 storage port the worker needs. */
export interface ObjectSource {
  getObjectBytes(key: string): Promise<Uint8Array>;
}

/** OCR port (satisfied by the LLM gateway's `ocrImageToMarkdown`). */
export interface OcrPort {
  ocrImageToMarkdown(req: { image: { dataUrl: string } }): Promise<string>;
}

/** Converts a PDF into per-page image data URLs (external tool; mocked in tests). */
export interface PdfToImagesPort {
  convert(bytes: Uint8Array): Promise<string[]>;
}

export interface DocumentWorkerDeps {
  storage: ObjectSource;
  documentRepo: DocumentRepo;
  chunkRepo: RagChunkRepo;
  embeddingProvider: EmbeddingProvider;
  ocr?: OcrPort;
  pdfToImages?: PdfToImagesPort;
  now?: () => number;
}

export interface ParsedDocument {
  text: string;
  pages?: PageSpan[];
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Collapses excessive blank lines / trailing whitespace; keeps content intact. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse a document into text (+ optional page spans). v1 supports text/markdown
 * directly and image/PDF via the OCR port; other binary types are unsupported.
 */
export async function parseDocument(
  bytes: Uint8Array,
  mimeType: string,
  deps: Pick<DocumentWorkerDeps, 'ocr' | 'pdfToImages'>,
): Promise<ParsedDocument> {
  const mt = mimeType.toLowerCase();
  if (mt.startsWith('text/') || mt === 'application/json' || mt.includes('markdown')) {
    return { text: Buffer.from(bytes).toString('utf-8') };
  }
  if (mt.startsWith('image/')) {
    if (!deps.ocr) throw new Error('UNSUPPORTED_FORMAT');
    const text = await deps.ocr.ocrImageToMarkdown({ image: { dataUrl: toDataUrl(bytes, mimeType) } });
    return { text };
  }
  if (mt === 'application/pdf') {
    if (!deps.ocr || !deps.pdfToImages) throw new Error('UNSUPPORTED_FORMAT');
    const images = await deps.pdfToImages.convert(bytes);
    const pageTexts = await Promise.all(
      images.map((dataUrl) => deps.ocr!.ocrImageToMarkdown({ image: { dataUrl } })),
    );
    const pages: PageSpan[] = [];
    let text = '';
    pageTexts.forEach((pt, i) => {
      const charStart = text.length;
      text += (i > 0 ? '\n\n' : '') + pt;
      pages.push({ page: i + 1, charStart, charEnd: text.length });
    });
    return { text, pages };
  }
  throw new Error('UNSUPPORTED_FORMAT');
}

export interface ProcessResult {
  documentId: string;
  status: 'indexed' | 'failed';
  chunkCount: number;
  insertedCount: number;
  errorCode?: string;
}

/** Run the full pipeline for one document version. Idempotent on re-run. */
export async function processDocument(
  job: DocumentJob,
  deps: DocumentWorkerDeps,
): Promise<ProcessResult> {
  const dim = deps.embeddingProvider.dim === 1536 ? 1536 : 768;
  const run = await deps.chunkRepo.startIndexRun({
    backend: 'pgvector',
    embeddingProvider: deps.embeddingProvider.providerId,
    embeddingModel: deps.embeddingProvider.model,
    embeddingDim: dim,
    sourceCount: 1,
  });

  try {
    const document = await deps.documentRepo.getDocumentById(job.documentId);
    const version = await deps.documentRepo.getLatestVersion(job.documentId);
    if (!document || !version?.storageKey) throw new Error('DOCUMENT_NOT_FOUND');

    const bytes = await deps.storage.getObjectBytes(version.storageKey);
    const parsed = await parseDocument(bytes, version.mimeType ?? 'text/plain', deps);
    const text = normalizeText(parsed.text);

    const chunks: Chunk[] = chunkDocument({
      text,
      ...(document.title ? { title: document.title } : {}),
      ...(document.documentType ? { documentType: document.documentType } : {}),
      ...(document.projectId ? { projectId: document.projectId } : {}),
      ...(parsed.pages ? { pages: parsed.pages } : {}),
    });

    const vectors = chunks.length
      ? await deps.embeddingProvider.embed(chunks.map((c) => c.contentEmbedding))
      : [];

    let inserted = 0;
    let tokens = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      tokens += c.tokenCount;
      const res = await deps.chunkRepo.upsertChunk({
        documentId: job.documentId,
        documentVersionId: job.documentVersionId,
        ownerUserId: document.ownerUserId,
        projectId: document.projectId,
        departmentId: document.departmentId,
        documentType: document.documentType,
        securityLevel: document.securityLevel,
        title: document.title,
        ...(c.pageFrom !== undefined ? { pageFrom: c.pageFrom } : {}),
        ...(c.pageTo !== undefined ? { pageTo: c.pageTo } : {}),
        chunkIndex: c.chunkIndex,
        tokenCount: c.tokenCount,
        charStart: c.charStart,
        charEnd: c.charEnd,
        contentOriginal: c.contentOriginal,
        contentEmbedding: c.contentEmbedding,
        sourceTextHash: c.sourceTextHash,
        chunkHash: c.chunkHash,
        chunkerVersion: c.chunkerVersion,
        embedding: vectors[i] ?? [],
        embeddingProvider: deps.embeddingProvider.providerId,
        embeddingModel: deps.embeddingProvider.model,
        embeddingDim: dim,
      });
      if (res.inserted) inserted++;
    }

    await deps.chunkRepo.finishIndexRun(run.id, {
      status: 'completed',
      chunkCount: chunks.length,
      tokenCount: tokens,
      successCount: chunks.length,
    });
    await deps.documentRepo.setStatus(job.documentId, 'indexed');
    log.info({ documentId: job.documentId, chunkCount: chunks.length, inserted }, 'document indexed');
    return { documentId: job.documentId, status: 'indexed', chunkCount: chunks.length, insertedCount: inserted };
  } catch (err) {
    const errorCode = err instanceof Error && err.message.startsWith('UNSUPPORTED') ? err.message : 'INDEXING_FAILED';
    await deps.chunkRepo.finishIndexRun(run.id, { status: 'failed', errorCount: 1, errorText: errorCode });
    await deps.documentRepo.setStatus(job.documentId, 'failed');
    // Log only a stable code — never the raw document/text.
    log.error({ documentId: job.documentId, errorCode }, 'document indexing failed');
    return { documentId: job.documentId, status: 'failed', chunkCount: 0, insertedCount: 0, errorCode };
  }
}
