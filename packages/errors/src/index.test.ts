import { describe, it, expect } from 'vitest';
import { AppError, AuthzError } from './index.js';

describe('AppError', () => {
  it('toPublic exposes only safe fields (no stack/meta leak)', () => {
    const err = new AuthzError('nope', { secretField: 'do-not-leak' });
    const body = err.toPublic('corr-1');
    expect(body).toEqual({
      error: { code: 'AUTHZ_DENIED', message: 'nope', correlationId: 'corr-1' },
    });
    expect(JSON.stringify(body)).not.toContain('do-not-leak');
  });

  it('defaults isOperational to true', () => {
    const err = new AppError({ code: 'X', httpStatus: 500, publicMessage: 'm' });
    expect(err.isOperational).toBe(true);
  });
});
