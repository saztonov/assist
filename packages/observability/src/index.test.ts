import { describe, it, expect } from 'vitest';
import { withSpan } from './index.js';

describe('observability', () => {
  it('withSpan runs and returns the wrapped fn result', async () => {
    expect(await withSpan('unit', () => 42)).toBe(42);
  });
});
