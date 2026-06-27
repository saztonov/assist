/** Document-processing worker. Idempotent by document_id/content hash. */
import { createLogger } from '@su10/logger';
import { makeIdempotencyKey } from '@su10/connectors';

const log = createLogger('document-worker');

export interface DocumentJob {
  documentId: string;
  contentHash: string;
}

const processed = new Set<string>();

export async function processDocument(
  job: DocumentJob,
): Promise<{ idempotencyKey: string; skipped: boolean }> {
  const key = makeIdempotencyKey(['document', job.documentId, job.contentHash]);
  if (processed.has(key)) {
    return { idempotencyKey: key, skipped: true };
  }
  processed.add(key);
  log.info({ documentId: job.documentId }, 'processing document');
  // Real impl: fetch blob via @su10/s3, parse/chunk/embed via @su10/rag.
  return { idempotencyKey: key, skipped: false };
}
