import { describe, it, expect } from 'vitest';
import { echoAgentBlockRunner } from './index.js';

describe('temporal-worker host', () => {
  it('echo agent runner is deterministic and does no network I/O', async () => {
    const res = await echoAgentBlockRunner({
      taskId: 't1',
      agentName: 'chat_agent',
      prompt: 'hello',
      subjectId: 'u1',
      roles: [],
      at: '2026-06-28T00:00:00.000Z',
    });
    expect(res.output).toBe('[chat_agent] hello');
  });
});
