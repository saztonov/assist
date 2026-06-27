import { describe, it, expect } from 'vitest';
import { retrieve, type RagDocument, type AclResolver } from './index.js';

const corpus: RagDocument[] = [
  { id: '1', aclTag: 'hr', content: 'confidential salary report' },
  { id: '2', aclTag: 'pub', content: 'public salary policy' },
];

describe('rag ACL filtering', () => {
  it('never returns documents outside the subject ACL', () => {
    const acl: AclResolver = { allowedTags: () => new Set(['pub']) };
    const out = retrieve('salary', { id: 'u', roles: [] }, corpus, acl);
    expect(out.map((c) => c.documentId)).toEqual(['2']);
  });
});
