// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isOidcConfigured } from './oidc';
import type { PublicConfig } from '@su10/config/public';

const base: PublicConfig = {
  VITE_API_BASE_URL: '/api',
  VITE_OIDC_SCOPE: 'openid profile email',
};

describe('isOidcConfigured', () => {
  it('false без issuer/clientId → dev-режим', () => {
    expect(isOidcConfigured(base)).toBe(false);
  });

  it('false если задан только issuer', () => {
    expect(isOidcConfigured({ ...base, VITE_OIDC_ISSUER_URL: 'https://auth' })).toBe(false);
  });

  it('true когда заданы issuer и clientId → OIDC-режим', () => {
    expect(
      isOidcConfigured({
        ...base,
        VITE_OIDC_ISSUER_URL: 'https://auth.su10.ru/realms/portal',
        VITE_OIDC_CLIENT_ID: 'ai-portal-web',
      }),
    ).toBe(true);
  });
});
