import { describe, it, expect } from 'vitest';
import { tokens } from './theme.js';

describe('ui theme', () => {
  it('exposes primary color and radius tokens', () => {
    expect(tokens.colorPrimary).toBeDefined();
    expect(tokens.borderRadius).toBeGreaterThan(0);
  });
});
