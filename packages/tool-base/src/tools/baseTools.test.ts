import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryAuditSink } from '@su10/audit';
import { NotFoundError } from '@su10/errors';
import type { ToolContext } from '@su10/tools';
import { createInMemoryBaseToolDeps } from '../inMemoryDeps.js';
import { taskGetStatusTool } from './taskGetStatus.js';
import { artifactCreateTool } from './artifactCreate.js';
import { approvalRequestTool } from './approvalRequest.js';
import { approvalResolveTool } from './approvalResolve.js';
import { notificationSendTool } from './notificationSend.js';

function makeDeps() {
  return createInMemoryBaseToolDeps();
}

const ctx = (id: string, roles: string[] = []): ToolContext => ({
  subject: { id, roles },
  auditSink: new InMemoryAuditSink(),
  at: '2026-01-01T00:00:00.000Z',
});

describe('task.get_status', () => {
  it('возвращает статус владельцу; чужому/несуществующему → NotFoundError', async () => {
    const { deps, taskRepo } = makeDeps();
    const t = await taskRepo.createTask({ createdBy: 'u-1', title: 'T' });
    const tool = taskGetStatusTool(deps);
    const out = await tool.handler({ taskId: t.id }, ctx('u-1'));
    expect(out).toMatchObject({ taskId: t.id, status: 'created', title: 'T' });
    await expect(tool.handler({ taskId: t.id }, ctx('u-2'))).rejects.toBeInstanceOf(NotFoundError);
    await expect(tool.handler({ taskId: randomUUID() }, ctx('u-1'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('artifact.create', () => {
  it('inputSchema отклоняет URL в storageKey', () => {
    const { deps } = makeDeps();
    const tool = artifactCreateTool(deps);
    const bad = tool.inputSchema.safeParse({
      taskId: randomUUID(),
      artifactType: 'report',
      storageKey: 'https://example/file',
    });
    expect(bad.success).toBe(false);
  });

  it('создаёт артефакт и возвращает artifactId', async () => {
    const { deps, artifacts } = makeDeps();
    const tool = artifactCreateTool(deps);
    const out = await tool.handler(
      { taskId: randomUUID(), artifactType: 'report', storageKey: 'tasks/t1/report.xlsx' },
      ctx('u-1'),
    );
    expect(out.artifactId).toMatch(/[0-9a-f-]{36}/);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].storageKey).toBe('tasks/t1/report.xlsx');
  });
});

describe('approval.request / approval.resolve', () => {
  it('request переводит running-задачу в waiting_for_approval', async () => {
    const { deps, taskRepo } = makeDeps();
    const t = await taskRepo.createTask({ createdBy: 'u-1' });
    await taskRepo.transitionStatus({ taskId: t.id, to: 'queued' });
    await taskRepo.transitionStatus({ taskId: t.id, to: 'running' });
    const out = await approvalRequestTool(deps).handler(
      { taskId: t.id, action: 'send_email', riskLevel: 'high' },
      ctx('u-1', ['agent.run']),
    );
    expect(out.status).toBe('pending');
    expect((await taskRepo.getTaskById(t.id))?.status).toBe('waiting_for_approval');
  });

  it('resolve(approved) возобновляет задачу (→ running)', async () => {
    const { deps, taskRepo } = makeDeps();
    const t = await taskRepo.createTask({ createdBy: 'u-1' });
    await taskRepo.transitionStatus({ taskId: t.id, to: 'queued' });
    await taskRepo.transitionStatus({ taskId: t.id, to: 'running' });
    const req = await approvalRequestTool(deps).handler(
      { taskId: t.id, action: 'send_email', riskLevel: 'high' },
      ctx('u-1', ['agent.run']),
    );
    const out = await approvalResolveTool(deps).handler(
      { approvalId: req.approvalId, decision: 'approved' },
      ctx('appr-1', ['approver']),
    );
    expect(out.status).toBe('approved');
    expect((await taskRepo.getTaskById(t.id))?.status).toBe('running');
  });

  it('resolve(rejected) переводит задачу в failed', async () => {
    const { deps, taskRepo } = makeDeps();
    const t = await taskRepo.createTask({ createdBy: 'u-1' });
    await taskRepo.transitionStatus({ taskId: t.id, to: 'queued' });
    await taskRepo.transitionStatus({ taskId: t.id, to: 'running' });
    const req = await approvalRequestTool(deps).handler(
      { taskId: t.id, action: 'x', riskLevel: 'high' },
      ctx('u-1', ['agent.run']),
    );
    await approvalResolveTool(deps).handler(
      { approvalId: req.approvalId, decision: 'rejected' },
      ctx('appr-1', ['approver']),
    );
    const task = await taskRepo.getTaskById(t.id);
    expect(task?.status).toBe('failed');
    expect(task?.errorCode).toBe('APPROVAL_REJECTED');
  });

  it('resolve неизвестного approval → NotFoundError', async () => {
    const { deps } = makeDeps();
    await expect(
      approvalResolveTool(deps).handler(
        { approvalId: randomUUID(), decision: 'approved' },
        ctx('appr-1', ['approver']),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('notification.send', () => {
  it('идемпотентен по dedupeKey', async () => {
    const { deps } = makeDeps();
    const tool = notificationSendTool(deps);
    const first = await tool.handler(
      { to: 'u@x', subject: 'S', body: 'B', dedupeKey: 'k-1' },
      ctx('u-1', ['notifications.send']),
    );
    expect(first.enqueued).toBe(true);
    const second = await tool.handler(
      { to: 'u@x', subject: 'S', body: 'B', dedupeKey: 'k-1' },
      ctx('u-1', ['notifications.send']),
    );
    expect(second.enqueued).toBe(false);
    expect(second.idempotencyKey).toBe('k-1');
  });
});
