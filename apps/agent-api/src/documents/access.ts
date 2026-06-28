/**
 * Document access control (pure, testable without HTTP). Owner + admin + ACL.
 * Departments are matched only if the subject carries department claims.
 */
export interface DocAccessSubject {
  sub: string;
  roles: string[];
  departments?: string[];
}

export interface DocLike {
  ownerUserId: string;
}

export interface AclLike {
  principalType: string;
  principalId: string;
  permission?: string;
}

export function isAdmin(roles: string[]): boolean {
  return roles.includes('admin');
}

/** Whether the subject may read the document (owner, admin, or matching ACL). */
export function canAccessDocument(
  subject: DocAccessSubject,
  doc: DocLike,
  acl: AclLike[],
): boolean {
  if (isAdmin(subject.roles)) return true;
  if (doc.ownerUserId === subject.sub) return true;
  for (const a of acl) {
    if (a.principalType === 'user' && a.principalId === subject.sub) return true;
    if (a.principalType === 'role' && subject.roles.includes(a.principalId)) return true;
    if (a.principalType === 'group' && subject.roles.includes(a.principalId)) return true;
    if (
      a.principalType === 'department' &&
      (subject.departments ?? []).includes(a.principalId)
    )
      return true;
  }
  return false;
}
