import { describe, it, expect } from 'vitest';
import type { AgentTaskActivities, RecordTaskStatusInput } from './activities.js';
import { GenericAgentTaskInputSchema, VisualTemplateInputSchema } from './contracts.js';
import {
  runGenericAgentTask,
  runVisualTemplate,
  type ApprovalOutcome,
  type OrchestrationEnv,
} from './orchestration.js';

interface FakeOpts {
  decision?: ApprovalOutcome;
  cancelBefore?: boolean;
  failAgent?: boolean;
}

function makeEnv(opts: FakeOpts = {}): {
  env: OrchestrationEnv;
  statuses: RecordTaskStatusInput[];
  calls: string[];
} {
  const statuses: RecordTaskStatusInput[] = [];
  const calls: string[] = [];
  let cancelRequested = opts.cancelBefore ?? false;

  const activities: AgentTaskActivities = {
    async recordTaskStatus(i) {
      statuses.push(i);
    },
    async runToolBlock(i) {
      calls.push(`tool:${i.name}`);
      return { ok: true };
    },
    async runAgentBlock(i) {
      calls.push(`agent:${i.agentName}`);
      if (opts.failAgent) throw new Error('agent boom');
      return { output: 'ok' };
    },
    async createArtifact() {
      calls.push('artifact');
      return { artifactId: 'a1' };
    },
    async requestApproval() {
      calls.push('approval.request');
      return { approvalId: 'ap1' };
    },
    async notifyUser() {
      calls.push('notify');
      return { enqueued: true };
    },
  };

  const env: OrchestrationEnv = {
    activities,
    now: () => '2026-06-28T00:00:00.000Z',
    isCancelRequested: () => cancelRequested,
    async awaitApprovalOrCancel() {
      const d = opts.decision ?? 'approved';
      if (d === 'cancelled') cancelRequested = true;
      return d;
    },
  };
  return { env, statuses, calls };
}

const genericInput = (over: Record<string, unknown> = {}) =>
  GenericAgentTaskInputSchema.parse({
    taskId: 't1',
    subject: { id: 'u1', roles: ['agent.run'] },
    ...over,
  });

describe('runGenericAgentTask', () => {
  it('happy path: running → completed', async () => {
    const { env, statuses, calls } = makeEnv();
    const res = await runGenericAgentTask(genericInput(), env);
    expect(res.status).toBe('completed');
    expect(statuses.map((s) => s.to)).toEqual(['running', 'completed']);
    expect(calls).toContain('agent:chat_agent');
  });

  it('approval approved: pause then resume to completed', async () => {
    const { env, statuses, calls } = makeEnv({ decision: 'approved' });
    const res = await runGenericAgentTask(genericInput({ requireApproval: true }), env);
    expect(res.status).toBe('completed');
    expect(calls).toContain('approval.request');
    // started→running, approval_granted→running, completed (waiting_for_approval — в activity).
    expect(statuses.map((s) => s.to)).toEqual(['running', 'running', 'completed']);
  });

  it('approval rejected: → failed APPROVAL_REJECTED', async () => {
    const { env, statuses } = makeEnv({ decision: 'rejected' });
    const res = await runGenericAgentTask(genericInput({ requireApproval: true }), env);
    expect(res).toEqual({ status: 'failed', errorCode: 'APPROVAL_REJECTED' });
    expect(statuses.at(-1)).toMatchObject({ to: 'failed', errorCode: 'APPROVAL_REJECTED' });
  });

  it('cancel during approval wait: stops without completing/failing', async () => {
    const { env, statuses } = makeEnv({ decision: 'cancelled' });
    const res = await runGenericAgentTask(genericInput({ requireApproval: true }), env);
    expect(res.status).toBe('cancelled');
    // только стартовый running; →cancelled принадлежит HTTP-слою.
    expect(statuses.map((s) => s.to)).toEqual(['running']);
  });

  it('cancel before agent block: stops, no completed', async () => {
    const { env, statuses } = makeEnv({ cancelBefore: true });
    const res = await runGenericAgentTask(genericInput(), env);
    expect(res.status).toBe('cancelled');
    expect(statuses.map((s) => s.to)).toEqual(['running']);
  });

  it('agent failure: → failed AGENT_BLOCK_FAILED', async () => {
    const { env, statuses } = makeEnv({ failAgent: true });
    const res = await runGenericAgentTask(genericInput(), env);
    expect(res).toEqual({ status: 'failed', errorCode: 'AGENT_BLOCK_FAILED' });
    expect(statuses.at(-1)).toMatchObject({ to: 'failed', errorCode: 'AGENT_BLOCK_FAILED' });
  });
});

const templateInput = (nodes: Array<Record<string, unknown>>, decision?: ApprovalOutcome) => ({
  parsed: VisualTemplateInputSchema.parse({
    taskId: 't1',
    subject: { id: 'u1', roles: ['agent.run', 'tasks.read'] },
    template: { id: 'tpl', name: 'demo', nodes, edges: [] },
  }),
  decision,
});

describe('runVisualTemplate', () => {
  it('executes trigger/tool/agent nodes → completed', async () => {
    const { env, statuses, calls } = makeEnv();
    const { parsed } = templateInput([
      { id: 'n0', type: 'manual_trigger', params: {} },
      { id: 'n1', type: 'tool', toolRef: 'task.get_status', params: { taskId: 't1' } },
      { id: 'n2', type: 'agent', toolRef: 'chat_agent', params: { prompt: 'hi' } },
    ]);
    const res = await runVisualTemplate(parsed, env);
    expect(res.status).toBe('completed');
    expect(calls).toEqual(['tool:task.get_status', 'agent:chat_agent']);
    expect(statuses.map((s) => s.to)).toEqual(['running', 'completed']);
  });

  it('approval node rejected → failed', async () => {
    const { env } = makeEnv({ decision: 'rejected' });
    const { parsed } = templateInput([{ id: 'n1', type: 'approval', toolRef: 'spend', params: {} }]);
    const res = await runVisualTemplate(parsed, env);
    expect(res).toEqual({ status: 'failed', errorCode: 'APPROVAL_REJECTED' });
  });

  it('ignores UI fields (position/label) — same calls (engine-ignored)', async () => {
    const { env, calls, statuses } = makeEnv();
    const { parsed } = templateInput([
      { id: 'n0', type: 'manual_trigger', label: 'Старт', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'n1',
        type: 'tool',
        toolRef: 'task.get_status',
        label: 'Статус',
        position: { x: 100, y: 0 },
        params: { taskId: 't1' },
      },
    ]);
    const res = await runVisualTemplate(parsed, env);
    expect(res.status).toBe('completed');
    expect(calls).toEqual(['tool:task.get_status']);
    expect(statuses.map((s) => s.to)).toEqual(['running', 'completed']);
  });

  it('cancel stops mid-template', async () => {
    const { env } = makeEnv({ cancelBefore: true });
    const { parsed } = templateInput([{ id: 'n1', type: 'tool', toolRef: 'x', params: {} }]);
    const res = await runVisualTemplate(parsed, env);
    expect(res.status).toBe('cancelled');
  });
});
