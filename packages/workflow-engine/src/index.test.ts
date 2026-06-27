import { describe, it, expect } from 'vitest';
import { runAgentTaskWorkflow, type AgentTaskActivities } from './index.js';

describe('workflow-engine', () => {
  it('drives task status transitions via injected activities', async () => {
    const statuses: string[] = [];
    const activities: AgentTaskActivities = {
      async recordTaskStatus(_id, status) {
        statuses.push(status);
      },
    };
    const id = await runAgentTaskWorkflow({ taskId: 'task-1', templateId: 'tpl-1' }, activities);
    expect(id).toBe('task-1');
    expect(statuses).toEqual(['running', 'completed']);
  });
});
