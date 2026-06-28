/**
 * ACL-before-retrieval predicate. NODE-ONLY, PURE.
 *
 * Translates an `ExecutionContext` into a structured predicate applied INSIDE the
 * retrieval query (vector/lexical/hydrate) — never as a post-filter. Fail-closed:
 * a missing/denied `PermissionDecision` throws; a scope outside the subject's
 * allowed projects/departments throws (unless admin).
 */
import { z } from 'zod';
import { AuthzError } from '@su10/errors';
import type { PermissionDecision, Subject } from '@su10/permissions';

export const RagScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all_allowed') }),
  z.object({ mode: z.literal('documents'), documentIds: z.array(z.string().min(1)).min(1) }),
  z.object({ mode: z.literal('project'), projectId: z.string().min(1) }),
  z.object({ mode: z.literal('department'), departmentId: z.string().min(1) }),
]);

export type RagScope = z.infer<typeof RagScopeSchema>;

export interface ExecutionContext {
  subject: Subject;
  permission: PermissionDecision;
  allowedDepartments?: string[];
  allowedProjects?: string[];
  scope?: RagScope;
}

export interface AclPredicate {
  isAdmin: boolean;
  subjectId: string;
  allowedDepartments: string[];
  allowedProjects: string[];
  restrictDocumentIds?: string[];
  restrictProjectId?: string;
  restrictDepartmentId?: string;
}

/** A chunk's ACL-relevant fields (subset used by visibility checks). */
export interface AclChunkFields {
  documentId: string;
  ownerUserId?: string | null;
  departmentId?: string | null;
  projectId?: string | null;
}

export function isAdminSubject(subject: Subject): boolean {
  return subject.roles.includes('admin');
}

/**
 * Build the ACL predicate. Throws `AuthzError` if not permitted (fail-closed) or
 * if a requested scope is outside the subject's entitlements.
 */
export function buildAclPredicate(ctx: ExecutionContext): AclPredicate {
  if (!ctx.permission || ctx.permission.allowed !== true) {
    throw new AuthzError('RAG retrieval denied: no allowing permission decision');
  }
  const isAdmin = isAdminSubject(ctx.subject);
  const allowedDepartments = ctx.allowedDepartments ?? [];
  const allowedProjects = ctx.allowedProjects ?? [];

  const predicate: AclPredicate = {
    isAdmin,
    subjectId: ctx.subject.id,
    allowedDepartments,
    allowedProjects,
  };

  const scope = ctx.scope ?? { mode: 'all_allowed' };
  switch (scope.mode) {
    case 'all_allowed':
      break;
    case 'documents':
      if (scope.documentIds.length === 0) {
        throw new AuthzError('RAG scope "documents" requires at least one document id');
      }
      predicate.restrictDocumentIds = scope.documentIds;
      break;
    case 'project':
      if (!isAdmin && !allowedProjects.includes(scope.projectId)) {
        throw new AuthzError('RAG scope project is not in the subject allowed projects');
      }
      predicate.restrictProjectId = scope.projectId;
      break;
    case 'department':
      if (!isAdmin && !allowedDepartments.includes(scope.departmentId)) {
        throw new AuthzError('RAG scope department is not in the subject allowed departments');
      }
      predicate.restrictDepartmentId = scope.departmentId;
      break;
  }
  return predicate;
}

/** Whether a chunk is visible under the predicate (mirrors the SQL WHERE). */
export function chunkMatchesPredicate(chunk: AclChunkFields, p: AclPredicate): boolean {
  const visible =
    p.isAdmin ||
    (chunk.ownerUserId != null && chunk.ownerUserId === p.subjectId) ||
    (chunk.departmentId != null && p.allowedDepartments.includes(chunk.departmentId)) ||
    (chunk.projectId != null && p.allowedProjects.includes(chunk.projectId));
  if (!visible) return false;
  if (p.restrictDocumentIds && !p.restrictDocumentIds.includes(chunk.documentId)) return false;
  if (p.restrictProjectId && chunk.projectId !== p.restrictProjectId) return false;
  if (p.restrictDepartmentId && chunk.departmentId !== p.restrictDepartmentId) return false;
  return true;
}

/** Derives a non-empty ACL scope tag list for `rag_queries` audit (no raw query). */
export function deriveScopeTags(ctx: ExecutionContext): string[] {
  const tags = new Set<string>([`user:${ctx.subject.id}`]);
  for (const r of ctx.subject.roles) tags.add(`role:${r}`);
  for (const d of ctx.allowedDepartments ?? []) tags.add(`dept:${d}`);
  for (const p of ctx.allowedProjects ?? []) tags.add(`project:${p}`);
  const scope = ctx.scope ?? { mode: 'all_allowed' };
  tags.add(`scope:${scope.mode}`);
  return [...tags];
}
