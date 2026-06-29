/**
 * Контроль доступа к шаблонам workflow: владелец + admin (по образцу
 * agent-tasks/access). Чистые функции — тестируемы без HTTP. Чужой/несуществующий
 * шаблон → 404 (не раскрываем существование).
 */
export interface TemplateAccessSubject {
  sub: string;
  roles: string[];
}

export function isAdmin(roles: string[]): boolean {
  return roles.includes('admin');
}

/** Видеть шаблон может admin или его владелец. */
export function canViewTemplate(
  subject: TemplateAccessSubject,
  template: { createdBy: string },
): boolean {
  return isAdmin(subject.roles) || template.createdBy === subject.sub;
}

/** Править/публиковать/прогонять может тот же, кто видит (владелец или admin). */
export function canEditTemplate(
  subject: TemplateAccessSubject,
  template: { createdBy: string },
): boolean {
  return canViewTemplate(subject, template);
}
