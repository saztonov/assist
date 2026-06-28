import { describe, it, expect } from 'vitest';
import { NotFoundError } from '@su10/errors';
import { createEnvSecretResolver } from './secretResolver.js';

describe('EnvSecretResolver', () => {
  const env = { LMSTUDIO_TOKEN: 's3cr3t', EMPTY: '' } as NodeJS.ProcessEnv;

  it('resolves a bare name from env', () => {
    expect(createEnvSecretResolver(env).resolve('LMSTUDIO_TOKEN')).toBe('s3cr3t');
  });

  it('resolves an "env:NAME" reference', () => {
    expect(createEnvSecretResolver(env).resolve('env:LMSTUDIO_TOKEN')).toBe('s3cr3t');
  });

  it('fails closed on missing/empty reference', () => {
    const r = createEnvSecretResolver(env);
    expect(() => r.resolve('MISSING')).toThrow(NotFoundError);
    expect(() => r.resolve('EMPTY')).toThrow(NotFoundError);
    expect(r.tryResolve('MISSING')).toBeUndefined();
    expect(r.tryResolve(undefined)).toBeUndefined();
  });

  it('never leaks the secret value in the thrown error', () => {
    const r = createEnvSecretResolver(env);
    try {
      r.resolve('MISSING');
    } catch (err) {
      expect(JSON.stringify((err as NotFoundError).toPublic('corr'))).not.toContain('s3cr3t');
    }
  });
});
