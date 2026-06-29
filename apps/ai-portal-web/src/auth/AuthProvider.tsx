/**
 * AuthProvider: OIDC-режим (Keycloak PKCE) при заданных VITE_OIDC_*, иначе
 * dev-token режим (local-first). Обновляет внешний `tokenStore`, который читает
 * `api/client.ts`. Токены в логи не пишутся.
 */
import { createContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User, UserManager } from 'oidc-client-ts';
import { createUserManager, oidcEnabled, isOidcCallback, cleanCallbackUrl } from './oidc';
import { setAccessToken, setDevToken, getDevToken } from './tokenStore';

export type AuthMode = 'oidc' | 'dev';
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
}

export interface AuthContextValue {
  mode: AuthMode;
  status: AuthStatus;
  user: AuthUser | null;
  login: () => void;
  logout: () => void;
  /** dev-режим: вручную задать/очистить токен (OIDC-режим игнорирует). */
  setDevTokenValue: (token: string | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(u: User): AuthUser {
  const profile = u.profile ?? {};
  return {
    sub: profile.sub,
    name: (profile.name as string | undefined) ?? (profile.preferred_username as string | undefined),
    email: profile.email,
  };
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const mode: AuthMode = oidcEnabled ? 'oidc' : 'dev';
  const managerRef = useRef<UserManager | null>(null);
  const [status, setStatus] = useState<AuthStatus>(mode === 'oidc' ? 'loading' : 'unauthenticated');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (mode !== 'oidc') {
      // dev-режим: считаем «аутентифицированным», если есть dev_token.
      setStatus(getDevToken() ? 'authenticated' : 'unauthenticated');
      return;
    }
    const manager = createUserManager();
    managerRef.current = manager;
    if (!manager) return;

    let cancelled = false;
    const applyUser = (u: User | null): void => {
      if (cancelled) return;
      if (u && !u.expired) {
        setAccessToken(u.access_token);
        setUser(toAuthUser(u));
        setStatus('authenticated');
      } else {
        setAccessToken(null);
        setUser(null);
        setStatus('unauthenticated');
      }
    };

    void (async () => {
      try {
        if (isOidcCallback()) {
          const u = await manager.signinRedirectCallback();
          cleanCallbackUrl();
          applyUser(u);
        } else {
          applyUser(await manager.getUser());
        }
      } catch {
        applyUser(null);
      }
    })();

    const onLoaded = (u: User): void => applyUser(u);
    const onUnloaded = (): void => applyUser(null);
    manager.events.addUserLoaded(onLoaded);
    manager.events.addUserUnloaded(onUnloaded);
    manager.events.addAccessTokenExpired(onUnloaded);
    return () => {
      cancelled = true;
      manager.events.removeUserLoaded(onLoaded);
      manager.events.removeUserUnloaded(onUnloaded);
      manager.events.removeAccessTokenExpired(onUnloaded);
    };
  }, [mode]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      status,
      user,
      login: () => {
        void managerRef.current?.signinRedirect();
      },
      logout: () => {
        if (mode === 'oidc') {
          setAccessToken(null);
          void managerRef.current?.signoutRedirect();
        } else {
          setDevToken(null);
          setStatus('unauthenticated');
        }
      },
      setDevTokenValue: (token: string | null) => {
        if (mode !== 'oidc') {
          setDevToken(token);
          setStatus(token ? 'authenticated' : 'unauthenticated');
        }
      },
    }),
    [mode, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
