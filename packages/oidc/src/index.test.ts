import { describe, it, expect } from 'vitest';
import { createOidc } from './index.js';

describe('oidc', () => {
  it('returns a verifier with a verify() method', () => {
    const oidc = createOidc({ issuerUrl: 'https://auth.su10.ru/realms/portal', audience: 'agent-api' });
    expect(typeof oidc.verify).toBe('function');
  });
});
