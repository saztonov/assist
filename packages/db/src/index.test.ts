import { describe, it, expect } from 'vitest';
import { agentTasks, schema } from './index.js';

describe('db schema', () => {
  it('exposes agent_tasks with a workflow_id column (status source of truth)', () => {
    expect(schema.agentTasks).toBe(agentTasks);
    expect(agentTasks.workflowId).toBeDefined();
    expect(agentTasks.status).toBeDefined();
  });
});
