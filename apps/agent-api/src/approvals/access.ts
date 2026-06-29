/**
 * Контроль доступа к approvals: subject (инициатор) + admin. Чистые функции.
 * Чужое/несуществующее approval трактуется как 404 на слое роутов.
 *
 * Примечание: в текущем mock `subjectId` — это субъект, который видит/решает
 * approval. Разделение «инициатор vs аппрувер» (роль-зависимое) — будущий этап.
 */
export interface ApprovalAccessSubject {
  sub: string;
  roles: string[];
}

export function isAdmin(roles: string[]): boolean {
  return roles.includes('admin');
}

export function canViewApproval(
  subject: ApprovalAccessSubject,
  approval: { subjectId: string },
): boolean {
  return isAdmin(subject.roles) || approval.subjectId === subject.sub;
}
