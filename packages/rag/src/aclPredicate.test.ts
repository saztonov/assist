import { describe, it, expect } from 'vitest';
import { AuthzError } from '@su10/errors';
import {
  buildAclPredicate,
  chunkMatchesPredicate,
  deriveScopeTags,
  type ExecutionContext,
} from './aclPredicate.js';

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  subject: { id: 'u-1', roles: [] },
  permission: { allowed: true },
  allowedDepartments: ['hr'],
  allowedProjects: ['p1'],
  ...over,
});

describe('buildAclPredicate (fail-closed)', () => {
  it('throws when there is no allowing permission decision', () => {
    expect(() => buildAclPredicate(ctx({ permission: { allowed: false } }))).toThrow(AuthzError);
  });

  it('all_allowed produces a visibility-only predicate', () => {
    const p = buildAclPredicate(ctx());
    expect(p.isAdmin).toBe(false);
    expect(p.restrictDocumentIds).toBeUndefined();
    expect(p.allowedDepartments).toEqual(['hr']);
  });

  it('project scope outside allowed projects is denied (non-admin)', () => {
    expect(() =>
      buildAclPredicate(ctx({ scope: { mode: 'project', projectId: 'secret' } })),
    ).toThrow(AuthzError);
  });

  it('admin may scope to any project/department', () => {
    const p = buildAclPredicate(
      ctx({ subject: { id: 'a', roles: ['admin'] }, scope: { mode: 'project', projectId: 'x' } }),
    );
    expect(p.isAdmin).toBe(true);
    expect(p.restrictProjectId).toBe('x');
  });

  it('documents scope requires at least one id', () => {
    expect(() => buildAclPredicate(ctx({ scope: { mode: 'documents', documentIds: [] } }))).toThrow(
      AuthzError,
    );
  });
});

describe('chunkMatchesPredicate', () => {
  const p = buildAclPredicate(ctx());

  it('matches owner / allowed department / allowed project', () => {
    expect(chunkMatchesPredicate({ documentId: 'd', ownerUserId: 'u-1' }, p)).toBe(true);
    expect(chunkMatchesPredicate({ documentId: 'd', departmentId: 'hr' }, p)).toBe(true);
    expect(chunkMatchesPredicate({ documentId: 'd', projectId: 'p1' }, p)).toBe(true);
  });

  it('rejects chunks the subject cannot see', () => {
    expect(
      chunkMatchesPredicate({ documentId: 'd', ownerUserId: 'u-2', departmentId: 'legal', projectId: 'p9' }, p),
    ).toBe(false);
  });

  it('admin sees everything', () => {
    const admin = buildAclPredicate(ctx({ subject: { id: 'a', roles: ['admin'] } }));
    expect(chunkMatchesPredicate({ documentId: 'd', ownerUserId: 'someone-else' }, admin)).toBe(true);
  });

  it('restrictDocumentIds narrows visible chunks', () => {
    const scoped = buildAclPredicate(ctx({ scope: { mode: 'documents', documentIds: ['d1'] } }));
    expect(chunkMatchesPredicate({ documentId: 'd1', ownerUserId: 'u-1' }, scoped)).toBe(true);
    expect(chunkMatchesPredicate({ documentId: 'd2', ownerUserId: 'u-1' }, scoped)).toBe(false);
  });
});

describe('deriveScopeTags', () => {
  it('always returns a non-empty tag set', () => {
    const tags = deriveScopeTags(ctx());
    expect(tags).toContain('user:u-1');
    expect(tags).toContain('dept:hr');
    expect(tags.length).toBeGreaterThan(0);
  });
});
