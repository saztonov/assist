/**
 * mail.save_attachments_to_s3 — persist attachments as first-class documents,
 * reusing the existing documents pipeline (S3 putObject → document + version →
 * confirm → optional Temporal processing for OCR/parse/embed). Idempotent by the
 * attachment's external source identity. Attachment BYTES never appear in the tool
 * output, audit, or logs.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { audit } from '@su10/audit';
import { ValidationError } from '@su10/errors';
import type { ToolDefinition } from '@su10/tools';
import { loadUsableMailAccount, providerForAccount, type MailToolDeps } from './deps.js';

const SOURCE_TYPE = 'mail_attachment';

const input = z.object({
  connector_account_id: z.string().uuid(),
  mailbox: z.string().min(1).optional(),
  uid: z.string().min(1),
  attachment_ids: z.array(z.string()).optional(),
  security_level: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  department_id: z.string().min(1).optional(),
  trigger_processing: z.boolean().default(true),
});

const output = z.object({
  saved: z.array(
    z.object({
      attachmentId: z.string(),
      documentId: z.string(),
      versionId: z.string().nullable(),
      objectKey: z.string().nullable(),
      status: z.string(),
      deduped: z.boolean(),
    }),
  ),
});

export function mailSaveAttachmentsToS3Tool(
  deps: MailToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'mail.save_attachments_to_s3',
    version: 1,
    description: 'Сохранить вложения письма в S3 как документы (с обработкой document-worker)',
    category: 'connector',
    riskLevel: 'medium',
    inputSchema: input,
    outputSchema: output,
    timeoutMs: 60000,
    async handler(inp, ctx) {
      const account = await loadUsableMailAccount(deps, ctx.subject, inp.connector_account_id);
      const provider = providerForAccount(deps, account);
      const mailbox = inp.mailbox ?? 'INBOX';

      const attachments = await provider.getAttachments(
        {
          uid: inp.uid,
          ...(inp.mailbox ? { mailbox: inp.mailbox } : {}),
          ...(inp.attachment_ids ? { attachmentIds: inp.attachment_ids } : {}),
        },
        ctx.signal,
      );

      const totalBytes = attachments.reduce((n, a) => n + a.bytes.length, 0);
      if (totalBytes > deps.options.maxAttachmentBytes) {
        throw new ValidationError('attachments exceed the maximum total size', {
          totalBytes,
          cap: deps.options.maxAttachmentBytes,
        });
      }

      const saved: z.infer<typeof output>['saved'] = [];
      for (const att of attachments) {
        const sourceObjectId = `${account.id}/${mailbox}/${inp.uid}/${att.attachmentId}`;
        const existing = await deps.documentRepo.findBySource(SOURCE_TYPE, sourceObjectId);
        if (existing) {
          const version = await deps.documentRepo.getLatestVersion(existing.id);
          saved.push({
            attachmentId: att.attachmentId,
            documentId: existing.id,
            versionId: version?.id ?? null,
            objectKey: version?.storageKey ?? null,
            status: existing.status,
            deduped: true,
          });
          continue;
        }

        const filename = att.filename ?? `attachment-${att.attachmentId}`;
        const mimeType = att.mimeType ?? 'application/octet-stream';
        const objectKey = deps.storage.buildObjectKey({
          filename,
          ...(inp.department_id ? { prefix: inp.department_id } : {}),
        });
        await deps.storage.putObject(objectKey, att.bytes, mimeType);
        const contentHash = createHash('sha256').update(att.bytes).digest('hex');

        const { document, version } = await deps.documentRepo.createUploadSession({
          ownerUserId: ctx.subject.id,
          createdBy: ctx.subject.id,
          filename,
          mimeType,
          sizeBytes: att.bytes.length,
          storageKey: objectKey,
          sourceObjectType: SOURCE_TYPE,
          sourceObjectId,
          ...(inp.security_level ? { securityLevel: inp.security_level } : {}),
          ...(inp.project_id ? { projectId: inp.project_id } : {}),
          ...(inp.department_id ? { departmentId: inp.department_id } : {}),
        });

        const head = await deps.storage.headObject(objectKey);
        const { document: confirmed } = await deps.documentRepo.confirmUpload({
          documentId: document.id,
          documentVersionId: version.id,
          sizeBytes: head?.size ?? att.bytes.length,
          contentHash,
        });

        let status = confirmed.status;
        if (inp.trigger_processing && deps.documentProcessing) {
          try {
            await deps.documentProcessing.start({
              documentId: document.id,
              documentVersionId: version.id,
              storageKey: objectKey,
              subject: { id: ctx.subject.id, roles: ctx.subject.roles },
            });
            status = (await deps.documentRepo.setStatus(document.id, 'indexing')).status;
          } catch {
            status = (await deps.documentRepo.setStatus(document.id, 'failed')).status;
          }
        }

        saved.push({
          attachmentId: att.attachmentId,
          documentId: document.id,
          versionId: version.id,
          objectKey,
          status,
          deduped: false,
        });
      }

      await audit(ctx.auditSink, {
        actor: ctx.subject.id,
        action: 'mail.save_attachments_to_s3',
        resource: `connector:${account.id}`,
        outcome: 'success',
        at: ctx.at,
        meta: {
          connectorAccountId: account.id,
          mailbox,
          uid: inp.uid,
          savedCount: saved.length,
          documentIds: saved.map((s) => s.documentId),
          deduped: saved.some((s) => s.deduped),
        },
      });

      return { saved };
    },
  };
}
