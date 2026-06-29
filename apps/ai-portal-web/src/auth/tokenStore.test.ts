// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAccessToken,
  setAccessToken,
  getDevToken,
  setDevToken,
} from './tokenStore';

describe('tokenStore', () => {
  beforeEach(() => {
    setAccessToken(null);
    localStorage.clear();
  });

  it('возвращает OIDC access-token, когда он задан', () => {
    setAccessToken('oidc-abc');
    expect(getAccessToken()).toBe('oidc-abc');
  });

  it('падает обратно на dev_token, когда OIDC-токена нет', () => {
    setDevToken('dev-xyz');
    expect(getAccessToken()).toBe('dev-xyz');
    expect(getDevToken()).toBe('dev-xyz');
  });

  it('OIDC access-token имеет приоритет над dev_token', () => {
    setDevToken('dev-xyz');
    setAccessToken('oidc-abc');
    expect(getAccessToken()).toBe('oidc-abc');
  });

  it('setDevToken(null) очищает dev_token', () => {
    setDevToken('dev-xyz');
    setDevToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
