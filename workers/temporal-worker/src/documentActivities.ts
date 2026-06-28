/**
 * Temporal activity wrapper around the document-worker pipeline. NODE-ONLY.
 *
 * The pipeline itself sets `documents.status` and writes index-run telemetry.
 * Transient failures are re-thrown so Temporal retries; permanent ones (e.g.
 * unsupported format) are returned so the workflow completes without retrying.
 */
import { processDocument, type DocumentWorkerDeps } from '@su10/document-worker';
import type { DocumentProcessingActivities } from '@su10/workflow-engine';

const PERMANENT_ERRORS = new Set(['UNSUPPORTED_FORMAT', 'DOCUMENT_NOT_FOUND']);

export function createDocumentActivities(deps: DocumentWorkerDeps): DocumentProcessingActivities {
  return {
    async processDocument(input) {
      const res = await processDocument(
        { documentId: input.documentId, documentVersionId: input.documentVersionId },
        deps,
      );
      if (res.status === 'failed' && res.errorCode && !PERMANENT_ERRORS.has(res.errorCode)) {
        // Transient: let Temporal retry the activity.
        throw new Error(res.errorCode);
      }
      return {
        documentId: res.documentId,
        status: res.status,
        chunkCount: res.chunkCount,
        ...(res.errorCode ? { errorCode: res.errorCode } : {}),
      };
    },
  };
}
