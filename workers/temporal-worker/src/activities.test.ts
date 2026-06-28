import { describe, it, expect } from 'vitest';
import { InMemoryAgentTaskRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import { createActivities } from './activities.js';

const AT = '2026-06-28T00:00:00.000Z';

function setup() {
  const base = createInMemoryBaseToolDeps();
  const registry = new ToolRegistry();
  registerBaseTools(registry, base.deps);
  const broker = new ToolBroker(registry);
  const auditSink = new InMemoryAuditSink();
  const activities = createActivities({
    taskRepo: base.taskRepo,
    approvalRepo: base.deps.approvalRepo,
    artifactRepo: base.deps.artifactRepo,
    outboxRepo: base.deps.outboxRepo,
    broker,
    auditSink,
  });
  return { base, activities, auditSink };
}

async function makeRunningTask(repo: InMemoryAgentTaskRepo): Promise<string> {
  const t = await repo.createTask({ createdBy: 'u1' });
  await repo.transitionStatus({ taskId: t.id, to: 'queued' });
  await repo.transitionStatus({ taskId: t.id, to: 'running' });
  return t.id;
}

describe('temporal activities', () => {
  it('recordTaskStatus drives transitions and is idempotent on retry', async () => {
    const { base, activities } = setup();
    const t = await base.taskRepo.createTask({ createdBy: 'u1' });
    await activities.recordTaskStatus({ taskId: t.id, to: 'queued' });
    await activities.recordTaskStatus({ taskId: t.id, to: 'running' });
    await activities.recordTaskStatus({ taskId: t.id, to: 'completed' });
    // Повтор (имитация ретрая Temporal) не должен бросать ConflictError.
    await expect(activities.recordTaskStatus({ taskId: t.id, to: 'completed' })).resolves.toBeUndefined();
    expect((await base.taskRepo.getTaskById(t.id))?.status).toBe('completed');
  });

  it('requestApproval creates approval and moves task to waiting_for_approval', async () => {
    const { base, activities } = setup();
    const taskId = await makeRunningTask(base.taskRepo);
    const res = await activities.requestApproval({
      taskId,
      subjectId: 'u1',
      action: 'spend',
      riskLevel: 'high',
      at: AT,
    });
    expect(res.approvalId).toBeTruthy();
    expect(base.approvals).toHaveLength(1);
    expect((await base.taskRepo.getTaskById(taskId))?.status).toBe('waiting_for_approval');
  });

  it('notifyUser is idempotent by dedupeKey (one side effect on retry)', async () => {
    const { activities, base } = setup();
    const first = await activities.notifyUser({
      to: 'u@x', subject: 's', body: 'b', dedupeKey: 'k1', subjectId: 'u1', at: AT,
    });
    const second = await activities.notifyUser({
      to: 'u@x', subject: 's', body: 'b', dedupeKey: 'k1', subjectId: 'u1', at: AT,
    });
    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(base.outboxKeys.size).toBe(1);
  });

  it('createArtifact stores an S3-key artifact', async () => {
    const { activities, base } = setup();
    const taskId = await makeRunningTask(base.taskRepo);
    const res = await activities.createArtifact({
      taskId, artifactType: 'report', storageKey: 'tasks/t/report.json',
    });
    expect(res.artifactId).toBeTruthy();
    expect(base.artifacts).toHaveLength(1);
    expect(base.artifacts[0].storageKey).toBe('tasks/t/report.json');
  });

  it('runToolBlock funnels through the broker and audits success', async () => {
    const { activities, base, auditSink } = setup();
    const t = await base.taskRepo.createTask({ createdBy: 'u1' });
    const out = (await activities.runToolBlock({
      name: 'task.get_status',
      input: { taskId: t.id },
      subjectId: 'u1',
      roles: ['admin'],
      at: AT,
      taskId: t.id,
    })) as { status: string };
    expect(out.status).toBe('created');
    expect(auditSink.events.some((e) => e.action === 'task.get_status' && e.outcome === 'success')).toBe(true);
  });
});
