/**
 * Хранилище текущего access-token ВНЕ React, чтобы не-React модуль `api/client.ts`
 * мог синхронно получить токен без циклов зависимостей. Заполняется из
 * `AuthProvider` (OIDC-режим). В dev-режиме токен берётся из localStorage `dev_token`.
 *
 * Токен в логи не пишется.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getDevToken(): string | null {
  try {
    return localStorage.getItem('dev_token');
  } catch {
    return null;
  }
}

export function setDevToken(token: string | null): void {
  try {
    if (token) localStorage.setItem('dev_token', token);
    else localStorage.removeItem('dev_token');
  } catch {
    /* localStorage недоступен — игнорируем */
  }
}

/** Текущий токен: OIDC access-token, иначе dev_token (local-first). */
export function getAccessToken(): string | null {
  return accessToken ?? getDevToken();
}
