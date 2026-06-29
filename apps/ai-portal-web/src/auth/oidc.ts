/**
 * OIDC (Keycloak) Authorization Code + PKCE через oidc-client-ts. Если
 * `VITE_OIDC_ISSUER_URL`/`VITE_OIDC_CLIENT_ID` не заданы — OIDC выключен и портал
 * работает в dev-token режиме (local-first).
 */
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { getPublicConfig, type PublicConfig } from '@su10/config/public';

const cfg = getPublicConfig(import.meta.env as Record<string, string | undefined>);

/** Чистая проверка — вынесена для юнит-тестов. */
export function isOidcConfigured(c: PublicConfig): boolean {
  return Boolean(c.VITE_OIDC_ISSUER_URL && c.VITE_OIDC_CLIENT_ID);
}

export const oidcEnabled = isOidcConfigured(cfg);

/** Создаёт UserManager (или null, если OIDC выключен). PKCE включается автоматически. */
export function createUserManager(): UserManager | null {
  if (!oidcEnabled) return null;
  return new UserManager({
    authority: cfg.VITE_OIDC_ISSUER_URL as string,
    client_id: cfg.VITE_OIDC_CLIENT_ID as string,
    redirect_uri: cfg.VITE_OIDC_REDIRECT_URI ?? window.location.origin,
    post_logout_redirect_uri: window.location.origin,
    response_type: 'code',
    scope: cfg.VITE_OIDC_SCOPE,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });
}

/** Признак того, что текущий URL — это OIDC redirect-callback (`?code&state`). */
export function isOidcCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('code') && params.has('state');
}

/** Убирает `code`/`state`/`session_state` из URL после обмена кода (без перезагрузки). */
export function cleanCallbackUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('session_state');
  url.searchParams.delete('iss');
  window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
}
