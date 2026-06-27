import { describe, it, expect } from 'vitest';
import { McpRegistry } from './index.js';

describe('mcp registry', () => {
  it('only treats allowlisted servers as callable', () => {
    const reg = new McpRegistry();
    reg.register({ id: 'srv-a', url: 'http://a', allowed: true, riskLevel: 'low' });
    reg.register({ id: 'srv-b', url: 'http://b', allowed: false, riskLevel: 'high' });
    expect(reg.isAllowed('srv-a')).toBe(true);
    expect(reg.isAllowed('srv-b')).toBe(false);
    expect(reg.isAllowed('unknown')).toBe(false);
  });
});
