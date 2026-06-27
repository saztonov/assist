/**
 * Retrieval over pgvector. NODE-ONLY.
 * ACL filtering ALWAYS happens BEFORE any content is returned for LLM context.
 */
import type { Subject } from '@su10/permissions';

export interface RagDocument {
  id: string;
  aclTag: string;
  content: string;
}

export interface RagChunk {
  documentId: string;
  content: string;
  score: number;
}

export interface AclResolver {
  /** Returns the ACL tags the subject is entitled to read. */
  allowedTags(subject: Subject): ReadonlySet<string>;
}

export function retrieve(
  query: string,
  subject: Subject,
  corpus: ReadonlyArray<RagDocument>,
  acl: AclResolver,
): RagChunk[] {
  const allowed = acl.allowedTags(subject);
  const q = query.toLowerCase();
  return corpus
    .filter((d) => allowed.has(d.aclTag)) // ACL filter FIRST (RAG-1)
    .filter((d) => d.content.toLowerCase().includes(q))
    .map((d) => ({ documentId: d.id, content: d.content, score: 1 }));
}
