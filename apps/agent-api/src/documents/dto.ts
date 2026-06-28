/** Zod DTOs for the Documents API (request validation + safe response serialization). */
import { z } from 'zod';

export const AclEntrySchema = z.object({
  principalType: z.enum(['user', 'role', 'department', 'group']),
  principalId: z.string().min(1),
  permission: z.enum(['read', 'write', 'admin']).default('read'),
});

export const UploadSessionBody = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().optional(),
  title: z.string().max(500).optional(),
  documentType: z.string().max(100).optional(),
  securityLevel: z.enum(['public', 'internal', 'confidential', 'secret']).default('internal'),
  projectId: z.string().max(200).optional(),
  departmentId: z.string().max(200).optional(),
  acl: z.array(AclEntrySchema).max(50).optional(),
});

export const UploadSessionResponse = z.object({
  documentId: z.string(),
  versionId: z.string(),
  objectKey: z.string(),
  // Presigned PUT URL — single-use, short-lived. Returned to the client; never logged.
  uploadUrl: z.string(),
  status: z.string(),
});

export const DocumentIdParams = z.object({ id: z.string().min(1) });

export const ConfirmResponse = z.object({
  documentId: z.string(),
  status: z.string(),
  parseJobId: z.string(),
});

export const DocumentCardResponse = z.object({
  id: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  documentType: z.string().nullable(),
  securityLevel: z.string(),
  createdAt: z.string(),
  version: z
    .object({
      id: z.string(),
      mimeType: z.string().nullable(),
      sizeBytes: z.number().nullable(),
    })
    .optional(),
});
