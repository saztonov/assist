import { describe, it, expect } from 'vitest';
import {
  AppError,
  AuthnError,
  AuthzError,
  NotImplementedError,
  ValidationError,
} from './index.js';

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

  it('maps AuthnError -> 401 and NotImplementedError -> 501', () => {
    expect(new AuthnError().httpStatus).toBe(401);
    expect(new AuthnError().code).toBe('AUTHN_REQUIRED');
    expect(new NotImplementedError().httpStatus).toBe(501);
    expect(new NotImplementedError().code).toBe('NOT_IMPLEMENTED');
  });

  it('serializes client-safe details but never internal meta', () => {
    const err = new ValidationError(
      'bad input',
      { rawBody: 'do-not-leak' },
      [{ path: 'name', message: 'required' }],
    );
    const body = err.toPublic('corr-2');
    expect(body.error.details).toEqual([{ path: 'name', message: 'required' }]);
    expect(JSON.stringify(body)).not.toContain('do-not-leak');
  });
});
