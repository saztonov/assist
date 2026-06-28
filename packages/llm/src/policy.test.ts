import { describe, it, expect } from 'vitest';
import { AuthzError, ValidationError } from '@su10/errors';
import { providerAllowsData, resolveModel, type ModelPolicy } from './policy.js';

const base: ModelPolicy = {
  allowedModels: ['qwen36-27b-mtp', 'lift'],
  taskModel: { analysis: 'qwen36-27b-mtp', extraction: 'lift' },
  providerAllowlist: [],
  localOnly: true,
  sensitiveDataPolicy: 'block',
  fallbackModel: 'qwen36-27b-mtp',
};

describe('resolveModel', () => {
  it('uses the task→model mapping', () => {
    expect(resolveModel(base, { task: 'analysis' })).toEqual({ model: 'qwen36-27b-mtp' });
  });

  it('honors an explicit allowed requested model', () => {
    expect(resolveModel(base, { task: 'extraction', requestedModel: 'lift' })).toEqual({
      model: 'lift',
    });
  });

  it('falls back when the requested model is not allowed', () => {
    expect(resolveModel(base, { task: 'analysis', requestedModel: 'chandra-ocr-2' })).toEqual({
      model: 'qwen36-27b-mtp',
    });
  });

  it('denies when not allowed and no allowed fallback exists', () => {
    const strict: ModelPolicy = { ...base, allowedModels: ['lift'], fallbackModel: undefined };
    expect(() => resolveModel(strict, { task: 'chat', requestedModel: 'x' })).toThrow(AuthzError);
  });

  it('throws when no model can be resolved', () => {
    const empty: ModelPolicy = { ...base, taskModel: {}, fallbackModel: undefined };
    expect(() => resolveModel(empty, { task: 'chat' })).toThrow(ValidationError);
  });
});

describe('providerAllowsData', () => {
  it('blocks sensitive data when policy says block', () => {
    expect(
      providerAllowsData(
        { localOnly: false, cloudAllowed: true, sensitiveDataPolicy: 'block' },
        { sensitive: true, isLocal: false },
      ),
    ).toBe(false);
  });

  it('blocks non-local providers when localOnly', () => {
    expect(
      providerAllowsData(
        { localOnly: true, cloudAllowed: true, sensitiveDataPolicy: 'allow' },
        { sensitive: false, isLocal: false },
      ),
    ).toBe(false);
  });

  it('allows local non-sensitive use', () => {
    expect(
      providerAllowsData(
        { localOnly: true, cloudAllowed: false, sensitiveDataPolicy: 'allow' },
        { sensitive: false, isLocal: true },
      ),
    ).toBe(true);
  });
});
