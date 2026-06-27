import { describe, it, expect } from 'vitest';
import { createLlmGateway } from './index.js';

describe('llm gateway', () => {
  it('exposes chat() and embed()', () => {
    const gw = createLlmGateway({ baseUrl: 'http://localhost:1234/v1', token: 't' });
    expect(typeof gw.chat).toBe('function');
    expect(typeof gw.embed).toBe('function');
  });
});
