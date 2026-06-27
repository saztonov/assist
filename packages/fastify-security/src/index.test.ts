import { describe, it, expect } from 'vitest';
import { securityPlugin } from './index.js';

describe('fastify-security', () => {
  it('exports a fastify plugin', () => {
    expect(typeof securityPlugin).toBe('function');
  });
});
