import { describe, it, expect } from 'vitest';
import { runAgentStep } from './index.js';

describe('agent-worker', () => {
  it('runs an agent step and returns output', async () => {
    expect(await runAgentStep({ prompt: 'ping' })).toContain('ping');
  });
});
