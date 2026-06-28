/**
 * Documents API (этап 9 / M2). Регистрируется ВНУТРИ authed-scope (`req.auth`).
 *
 * Upload flow: backend создаёт upload session (document `pending_upload` + version
 * с S3 object key) и выдаёт presigned PUT URL (НЕ логируется); затем confirm
 * проверяет объект в S3 (`headObject`) и переводит документ в `uploaded` + создаёт
 * parse-job. Доступ — владелец/admin/ACL. Запуск обработки (Temporal) — в M6.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { ConflictError, NotFoundError } from '@su10/errors';
import type { DocumentRepo } from '@su10/db';
import type { DocumentStoragePort } from '@su10/s3';
import { DOCUMENT_ACTIONS } from '../audit/auditActions.js';
import { canAccessDocument } from './access.js';
import {
  ConfirmResponse,
  DocumentCardResponse,
  DocumentIdParams,
  UploadSessionBody,
  UploadSessionResponse,
} from './dto.js';

/** Optional hook to kick off document processing on confirm (wired in M6). */
export interface DocumentProcessingPort {
  start(input: {
    documentId: string;
    documentVersionId: string;
    storageKey: string;
    subject: { id: string; roles: string[] };
  }): Promise<{ workflowId?: string } | void>;
}

export interface DocumentsDeps {
  documentRepo: DocumentRepo;
  storage: DocumentStoragePort;
  auditSink: AuditSink;
  documentProcessing?: DocumentProcessingPort;
}

function authOf(req: FastifyRequest): { sub: string; roles: string[] } {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('document not found');
  return { sub: auth.sub, roles: auth.roles };
}

const nowIso = (): string => new Date().toISOString();

export const documentsRoutes: FastifyPluginAsync<DocumentsDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { documentRepo, storage, auditSink } = deps;

  // POST /documents/upload-session — create document + presigned PUT URL.
  app.post(
    '/documents/upload-session',
    {
      schema: {
        tags: ['documents'],
        summary: 'Создать сессию загрузки документа (presigned PUT)',
        body: UploadSessionBody,
        response: { 201: UploadSessionResponse },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const body = req.body;
      const objectKey = storage.buildObjectKey({
        filename: body.filename,
        ...(body.departmentId ? { prefix: body.departmentId } : {}),
      });
      const { document, version } = await documentRepo.createUploadSession({
        ownerUserId: auth.sub,
        createdBy: auth.sub,
        title: body.title ?? null,
        documentType: body.documentType ?? null,
        securityLevel: body.securityLevel,
        projectId: body.projectId ?? null,
        departmentId: body.departmentId ?? null,
        filename: body.filename,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes ?? null,
        storageKey: objectKey,
        ...(body.acl ? { acl: body.acl } : {}),
      });
      // Presigned URL: returned to the client, NEVER logged.
      const uploadUrl = await storage.presignPut(objectKey, body.mimeType);
      await audit(auditSink, {
        actor: auth.sub,
        action: DOCUMENT_ACTIONS.uploadSession,
        resource: `document:${document.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { documentId: document.id, versionId: version.id, status: document.status },
      });
      return reply.code(201).send({
        documentId: document.id,
        versionId: version.id,
        objectKey,
        uploadUrl,
        status: document.status,
      });
    },
  );

  // POST /documents/:id/confirm — verify object in S3, mark uploaded, enqueue parse.
  app.post(
    '/documents/:id/confirm',
    {
      schema: {
        tags: ['documents'],
        summary: 'Подтвердить загрузку (verify object) и поставить в обработку',
        params: DocumentIdParams,
        response: { 200: ConfirmResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const document = await documentRepo.getDocumentById(req.params.id);
      if (!document) throw new NotFoundError('document not found');
      const acl = await documentRepo.listAcl(document.id);
      if (!canAccessDocument(auth, document, acl)) throw new NotFoundError('document not found');

      const version = await documentRepo.getLatestVersion(document.id);
      if (!version?.storageKey) throw new ConflictError('document has no storage object');

      const head = await storage.headObject(version.storageKey);
      if (!head) throw new ConflictError('uploaded object not found in storage');

      const { document: confirmed, parseJob } = await documentRepo.confirmUpload({
        documentId: document.id,
        documentVersionId: version.id,
        sizeBytes: head.size ?? version.sizeBytes ?? null,
      });

      let status = confirmed.status;
      // Kick off processing if wired (M6). Failure must not lose the confirm.
      if (deps.documentProcessing) {
        try {
          await deps.documentProcessing.start({
            documentId: document.id,
            documentVersionId: version.id,
            storageKey: version.storageKey,
            subject: { id: auth.sub, roles: auth.roles },
          });
          status = (await documentRepo.setStatus(document.id, 'indexing')).status;
        } catch (err) {
          req.log.error({ err }, 'document processing start failed');
          status = (await documentRepo.setStatus(document.id, 'failed')).status;
        }
      }

      await audit(auditSink, {
        actor: auth.sub,
        action: DOCUMENT_ACTIONS.confirm,
        resource: `document:${document.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { documentId: document.id, status, parseJobId: parseJob.id },
      });
      return { documentId: document.id, status, parseJobId: parseJob.id };
    },
  );

  // GET /documents/:id — metadata (ACL-checked). No storage URL leakage.
  app.get(
    '/documents/:id',
    {
      schema: {
        tags: ['documents'],
        summary: 'Карточка документа (метаданные, ACL-проверка)',
        params: DocumentIdParams,
        response: { 200: DocumentCardResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const document = await documentRepo.getDocumentById(req.params.id);
      if (!document) throw new NotFoundError('document not found');
      const acl = await documentRepo.listAcl(document.id);
      if (!canAccessDocument(auth, document, acl)) throw new NotFoundError('document not found');
      const version = await documentRepo.getLatestVersion(document.id);
      return {
        id: document.id,
        status: document.status,
        title: document.title,
        documentType: document.documentType,
        securityLevel: document.securityLevel,
        createdAt: document.createdAt.toISOString(),
        ...(version
          ? {
              version: {
                id: version.id,
                mimeType: version.mimeType,
                sizeBytes: version.sizeBytes,
              },
            }
          : {}),
      };
    },
  );
};
