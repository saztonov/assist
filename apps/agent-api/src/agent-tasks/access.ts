/**
 * Контроль доступа к задачам (этап 4): владелец + admin. Чистые функции —
 * тестируемы без HTTP. Реальный department/project RBAC — позже (когда `can()`
 * в `@su10/permissions` будет реализован).
 */
export interface TaskAccessSubject {
  sub: string;
  roles: string[];
}

export function isAdmin(roles: string[]): boolean {
  return roles.includes('admin');
}

/** Видеть задачу может admin или её владелец. */
export function canViewTask(subject: TaskAccessSubject, task: { createdBy: string }): boolean {
  return isAdmin(subject.roles) || task.createdBy === subject.sub;
}

/** Отменять может тот же, кто видит (владелец или admin). */
export function canCancelTask(subject: TaskAccessSubject, task: { createdBy: string }): boolean {
  return canViewTask(subject, task);
}
