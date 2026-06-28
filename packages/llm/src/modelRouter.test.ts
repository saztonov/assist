import { describe, it, expect } from 'vitest';
import { bucketForModel, modelForPurpose } from './modelRouter.js';
import type { LlmGatewayConfig } from './types.js';

const cfg = {
  models: { chandra: 'chandra-ocr-2', lift: 'lift', qwen: 'qwen36-27b-mtp' },
  defaults: { chat: 'qwen36-27b-mtp', ocr: 'chandra-ocr-2', extraction: 'lift' },
} as LlmGatewayConfig;

describe('modelRouter', () => {
  it('maps model ids to concurrency buckets', () => {
    expect(bucketForModel('chandra-ocr-2', cfg.models)).toBe('chandra');
    expect(bucketForModel('lift', cfg.models)).toBe('lift');
    expect(bucketForModel('qwen36-27b-mtp', cfg.models)).toBe('qwen');
    expect(bucketForModel('unknown', cfg.models)).toBeUndefined();
  });

  it('selects the default model per task class', () => {
    expect(modelForPurpose('ocr', cfg)).toBe('chandra-ocr-2');
    expect(modelForPurpose('extraction', cfg)).toBe('lift');
    expect(modelForPurpose('analysis', cfg)).toBe('qwen36-27b-mtp');
    expect(modelForPurpose('chat', cfg)).toBe('qwen36-27b-mtp');
  });
});
