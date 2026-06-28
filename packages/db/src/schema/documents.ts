/**
 * Документная метадата портала. `documents` + `document_versions` + `document_acl`
 * — источник истины метаданных и прав доступа. Поисковые чанки и эмбеддинги
 * хранятся в изолированной схеме `rag` (канон retrieval — `rag.corpus_chunks`).
 */
import { pgTable, uuid, text, integer, bigint, jsonb } from 'drizzle-orm/pg-core';
import { uuidPk, createdAt, updatedAt, tsOptional } from './_columns.js';

export const documents = pgTable('documents', {
  id: uuidPk(),
  ownerUserId: text('owner_user_id').notNull(),
  departmentId: text('department_id'),
  projectId: text('project_id'),
  documentType: text('document_type'),
  securityLevel: text('security_level').notNull().default('internal'),
  title: text('title'),
  sourceObjectType: text('source_object_type'),
  sourceObjectId: text('source_object_id'),
  contentHash: text('content_hash'),
  status: text('status').notNull().default('registered'),
  createdBy: text('created_by').notNull(),
  metadataJson: jsonb('metadata_json'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const documentVersions = pgTable('document_versions', {
  id: uuidPk(),
  documentId: uuid('document_id').notNull(),
  version: integer('version').notNull(),
  // S3 object key (не presigned URL).
  storageKey: text('storage_key'),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  contentHash: text('content_hash'),
  pageCount: integer('page_count'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const documentAcl = pgTable('document_acl', {
  id: uuidPk(),
  documentId: uuid('document_id').notNull(),
  principalType: text('principal_type').notNull(), // user | role | department | group
  principalId: text('principal_id').notNull(),
  permission: text('permission').notNull().default('read'), // read | write | admin
  createdBy: text('created_by'),
  createdAt: createdAt(),
});

export const documentParseJobs = pgTable('document_parse_jobs', {
  id: uuidPk(),
  documentId: uuid('document_id').notNull(),
  documentVersionId: uuid('document_version_id'),
  status: text('status').notNull().default('pending'),
  parser: text('parser'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  errorCode: text('error_code'),
  startedAt: tsOptional('started_at'),
  completedAt: tsOptional('completed_at'),
  metadataJson: jsonb('metadata_json'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
