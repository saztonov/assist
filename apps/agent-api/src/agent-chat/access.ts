/**
 * Контроль доступа к чат-сессиям: владелец + admin. Чистые функции — тестируемы
 * без HTTP. Чужая/несуществующая сессия трактуется как 404 на слое роутов.
 */
export interface ChatAccessSubject {
  sub: string;
  roles: string[];
}

export function isAdmin(roles: string[]): boolean {
  return roles.includes('admin');
}

/** Видеть/писать в сессию может admin или её владелец. */
export function canUseSession(subject: ChatAccessSubject, session: { userId: string }): boolean {
  return isAdmin(subject.roles) || session.userId === subject.sub;
}
