/**
 * Контракт RAG-запроса (ACL-before-retrieval), NODE-ONLY.
 *
 * Запрос НЕ может быть построен без непустого ACL-scope и разрешающего
 * permission decision — поведение fail-closed (RAG-1 / CONTRACT I4). Результат —
 * безопасная для вставки в `rag_queries` форма: метаданные + ACL-решение + хэш
 * запроса, БЕЗ сырого тела запроса.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthzError, ValidationError } from '@su10/errors';

export const PermissionDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
});
export type PermissionDecisionInput = z.infer<typeof PermissionDecisionSchema>;

/** Контракт входа RAG-запроса. `aclScope` обязателен и непуст. */
export const RagQueryContract = z.object({
  subjectId: z.string().min(1),
  query: z.string().min(1),
  aclScope: z.array(z.string().min(1)).min(1),
  permissionDecision: PermissionDecisionSchema,
  ragIndexId: z.string().optional(),
  profile: z.string().optional(),
});
export type RagQueryRequest = z.infer<typeof RagQueryContract>;

/** Безопасная форма строки `rag_queries` (без сырого тела запроса). */
export interface RagQueryRow {
  subjectId: string;
  ragIndexId?: string;
  aclScope: string[];
  permissionDecision: 'allowed';
  queryHash: string;
  profile?: string;
}

/**
 * Строит метаданные RAG-запроса. Fail-closed:
 * - нет/пустой `aclScope` или нет `permissionDecision` → ValidationError;
 * - `permissionDecision.allowed !== true` → AuthzError.
 * Возвращает форму без сырого текста запроса (только sha256-хэш).
 */
export function buildRagQuery(input: unknown): RagQueryRow {
  const parsed = RagQueryContract.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      'RAG query contract: требуется subjectId, query и непустой aclScope с permission decision',
      undefined,
      parsed.error.flatten(),
    );
  }

  const data = parsed.data;
  if (data.permissionDecision.allowed !== true) {
    // ACL-решение запрещает доступ — запрос не строится (fail-closed).
    throw new AuthzError('RAG query denied: ACL permission decision is not allowed');
  }

  return {
    subjectId: data.subjectId,
    ragIndexId: data.ragIndexId,
    aclScope: data.aclScope,
    permissionDecision: 'allowed',
    queryHash: createHash('sha256').update(data.query, 'utf8').digest('hex'),
    profile: data.profile,
  };
}
