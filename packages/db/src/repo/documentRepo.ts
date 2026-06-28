/**
 * Document metadata repository. NODE-ONLY.
 *
 * `documents` + `document_versions` + `document_acl` are the source of truth for
 * document metadata and access. `document_versions.storage_key` holds the S3
 * OBJECT KEY (never a presigned URL). An upload session is modeled as a document
 * in status `pending_upload` plus its first version; confirm flips it to
 * `uploaded` and enqueues a parse job. Raw file bytes are never stored in the DB.
 */
import { desc, eq } from 'drizzle-orm';
import {
  documents,
  documentVersions,
  documentAcl,
  documentParseJobs,
} from '../schema/documents.js';
import type { Database } from '../index.js';

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
export type DocumentAclRow = typeof documentAcl.$inferSelect;
export type DocumentParseJobRow = typeof documentParseJobs.$inferSelect;

export type DocumentStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'indexing'
  | 'indexed'
  | 'failed'
  | 'registered';

export interface DocumentAclEntry {
  principalType: 'user' | 'role' | 'department' | 'group';
  principalId: string;
  permission?: 'read' | 'write' | 'admin';
}

export interface CreateUploadSessionInput {
  ownerUserId: string;
  createdBy: string;
  title?: string | null;
  documentType?: string | null;
  securityLevel?: string;
  projectId?: string | null;
  departmentId?: string | null;
  sourceObjectType?: string | null;
  sourceObjectId?: string | null;
  metadata?: Record<string, unknown> | null;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
  storageKey: string;
  acl?: DocumentAclEntry[];
}

export interface ConfirmUploadInput {
  documentId: string;
  documentVersionId: string;
  sizeBytes?: number | null;
  contentHash?: string | null;
  parser?: string | null;
}

export interface DocumentRepo {
  createUploadSession(
    input: CreateUploadSessionInput,
  ): Promise<{ document: DocumentRow; version: DocumentVersionRow }>;
  getDocumentById(id: string): Promise<DocumentRow | undefined>;
  getLatestVersion(documentId: string): Promise<DocumentVersionRow | undefined>;
  listAcl(documentId: string): Promise<DocumentAclRow[]>;
  setStatus(documentId: string, status: DocumentStatus): Promise<DocumentRow>;
  confirmUpload(
    input: ConfirmUploadInput,
  ): Promise<{ document: DocumentRow; parseJob: DocumentParseJobRow }>;
}

function ownerAcl(ownerUserId: string): DocumentAclEntry {
  return { principalType: 'user', principalId: ownerUserId, permission: 'admin' };
}

/** Owner ACL plus caller-provided entries, de-duplicated. */
export function buildAclEntries(
  ownerUserId: string,
  extra: DocumentAclEntry[] = [],
): DocumentAclEntry[] {
  const seen = new Set<string>();
  const out: DocumentAclEntry[] = [];
  for (const e of [ownerAcl(ownerUserId), ...extra]) {
    const key = `${e.principalType}:${e.principalId}:${e.permission ?? 'read'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function createDocumentRepo(db: Database): DocumentRepo {
  return {
    async createUploadSession(input) {
      return db.transaction(async (tx) => {
        const [document] = await tx
          .insert(documents)
          .values({
            ownerUserId: input.ownerUserId,
            createdBy: input.createdBy,
            title: input.title ?? null,
            documentType: input.documentType ?? null,
            securityLevel: input.securityLevel ?? 'internal',
            projectId: input.projectId ?? null,
            departmentId: input.departmentId ?? null,
            sourceObjectType: input.sourceObjectType ?? null,
            sourceObjectId: input.sourceObjectId ?? null,
            metadataJson: input.metadata ?? null,
            status: 'pending_upload',
          })
          .returning();
        const [version] = await tx
          .insert(documentVersions)
          .values({
            documentId: document.id,
            version: 1,
            storageKey: input.storageKey,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes ?? null,
            createdBy: input.createdBy,
          })
          .returning();
        const aclRows = buildAclEntries(input.ownerUserId, input.acl).map((e) => ({
          documentId: document.id,
          principalType: e.principalType,
          principalId: e.principalId,
          permission: e.permission ?? 'read',
          createdBy: input.createdBy,
        }));
        await tx.insert(documentAcl).values(aclRows);
        return { document, version };
      });
    },

    async getDocumentById(id) {
      const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
      return row;
    },

    async getLatestVersion(documentId) {
      const [row] = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId))
        .orderBy(desc(documentVersions.version))
        .limit(1);
      return row;
    },

    async listAcl(documentId) {
      return db.select().from(documentAcl).where(eq(documentAcl.documentId, documentId));
    },

    async setStatus(documentId, status) {
      const [row] = await db
        .update(documents)
        .set({ status, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
        .returning();
      return row;
    },

    async confirmUpload(input) {
      return db.transaction(async (tx) => {
        await tx
          .update(documentVersions)
          .set({
            sizeBytes: input.sizeBytes ?? null,
            contentHash: input.contentHash ?? null,
          })
          .where(eq(documentVersions.id, input.documentVersionId));
        const [document] = await tx
          .update(documents)
          .set({
            status: 'uploaded',
            contentHash: input.contentHash ?? null,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, input.documentId))
          .returning();
        const [parseJob] = await tx
          .insert(documentParseJobs)
          .values({
            documentId: input.documentId,
            documentVersionId: input.documentVersionId,
            status: 'pending',
            parser: input.parser ?? null,
          })
          .returning();
        return { document, parseJob };
      });
    },
  };
}

// ── In-memory implementation (tests) ─────────────────────────────────────────

export class InMemoryDocumentRepo implements DocumentRepo {
  readonly documents: DocumentRow[] = [];
  readonly versions: DocumentVersionRow[] = [];
  readonly acl: DocumentAclRow[] = [];
  readonly parseJobs: DocumentParseJobRow[] = [];
  private seq = 0;

  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1) + this.seq++ * 1000);
  }

  private id(prefix: string): string {
    return `${prefix}-${this.seq++}`;
  }

  async createUploadSession(input: CreateUploadSessionInput) {
    const ts = this.now();
    const document: DocumentRow = {
      id: this.id('doc'),
      ownerUserId: input.ownerUserId,
      departmentId: input.departmentId ?? null,
      projectId: input.projectId ?? null,
      documentType: input.documentType ?? null,
      securityLevel: input.securityLevel ?? 'internal',
      title: input.title ?? null,
      sourceObjectType: input.sourceObjectType ?? null,
      sourceObjectId: input.sourceObjectId ?? null,
      contentHash: null,
      status: 'pending_upload',
      createdBy: input.createdBy,
      metadataJson: input.metadata ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.documents.push(document);
    const version: DocumentVersionRow = {
      id: this.id('ver'),
      documentId: document.id,
      version: 1,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes ?? null,
      contentHash: null,
      pageCount: null,
      createdBy: input.createdBy,
      createdAt: ts,
    };
    this.versions.push(version);
    for (const e of buildAclEntries(input.ownerUserId, input.acl)) {
      this.acl.push({
        id: this.id('acl'),
        documentId: document.id,
        principalType: e.principalType,
        principalId: e.principalId,
        permission: e.permission ?? 'read',
        createdBy: input.createdBy,
        createdAt: ts,
      });
    }
    return { document, version };
  }

  async getDocumentById(id: string) {
    return this.documents.find((d) => d.id === id);
  }

  async getLatestVersion(documentId: string) {
    return [...this.versions]
      .filter((v) => v.documentId === documentId)
      .sort((a, b) => b.version - a.version)[0];
  }

  async listAcl(documentId: string) {
    return this.acl.filter((a) => a.documentId === documentId);
  }

  async setStatus(documentId: string, status: DocumentStatus) {
    const doc = this.documents.find((d) => d.id === documentId);
    if (!doc) throw new Error('document not found');
    doc.status = status;
    doc.updatedAt = this.now();
    return doc;
  }

  async confirmUpload(input: ConfirmUploadInput) {
    const version = this.versions.find((v) => v.id === input.documentVersionId);
    if (version) {
      version.sizeBytes = input.sizeBytes ?? version.sizeBytes;
      version.contentHash = input.contentHash ?? null;
    }
    const document = await this.setStatus(input.documentId, 'uploaded');
    document.contentHash = input.contentHash ?? null;
    const parseJob: DocumentParseJobRow = {
      id: this.id('job'),
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      status: 'pending',
      parser: input.parser ?? null,
      attempts: 0,
      maxAttempts: 5,
      errorCode: null,
      startedAt: null,
      completedAt: null,
      metadataJson: null,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.parseJobs.push(parseJob);
    return { document, parseJob };
  }
}
