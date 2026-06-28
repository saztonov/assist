/**
 * Document-processing worker. Pure, dependency-injected indexing pipeline
 * (parse/OCR → normalize → chunk → embed → store). Idempotent by content hashes.
 * Orchestrated by a Temporal workflow (see @su10/workflow-engine).
 */
export * from './pipeline.js';
