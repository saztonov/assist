/**
 * Integration-тест Temporal через @temporalio/testing (TestWorkflowEnvironment).
 * GATED: запускается только при RUN_TEMPORAL_IT=1 (требует скачиваемый test-server),
 * поэтому offline-CI остаётся зелёным. Локально: `RUN_TEMPORAL_IT=1 pnpm vitest ...`.
 *
 * Проверяет реальный детерминированный workflow + activities: happy path и
 * approval pause→resume через сигнал. Активити — in-memory (без сети/БД).
 */
import { createRequire } from 'node:module';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createInMemoryBaseToolDeps, registerBaseTools } from '@su10/tool-base';
import { GenericAgentTaskInputSchema } from '@su10/workflow-engine';
import { createActivities } from './activities.js';

const RUN_IT = process.env.RUN_TEMPORAL_IT === '1';
const TASK_QUEUE = 'it-temporal-worker';

describe.skipIf(!RUN_IT)('temporal workflow IT', () => {
  // Типы импортируются лениво, чтобы offline-CI не грузил @temporalio/testing.
  let env: Awaited<ReturnType<typeof import('@temporalio/testing').TestWorkflowEnvironment.createTimeSkipping>>;
  let WorkerCtor: typeof import('@temporalio/worker').Worker;

  beforeAll(async () => {
    const { TestWorkflowEnvironment } = await import('@temporalio/testing');
    ({ Worker: WorkerCtor } = await import('@temporalio/worker'));
    env = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  function makeWorker(runId: string) {
    const base = createInMemoryBaseToolDeps();
    const registry = new ToolRegistry();
    registerBaseTools(registry, base.deps);
    const broker = new ToolBroker(registry);
    const activities = createActivities({
      taskRepo: base.taskRepo,
      approvalRepo: base.deps.approvalRepo,
      artifactRepo: base.deps.artifactRepo,
      outboxRepo: base.deps.outboxRepo,
      broker,
      auditSink: new InMemoryAuditSink(),
    });
    const require = createRequire(import.meta.url);
    return { base, runId, workerP: WorkerCtor.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('@su10/workflow-engine/workflows'),
      activities,
    }) };
  }

  it('generic workflow: queued → running → completed', async () => {
    const { base, workerP } = makeWorker('wf-1');
    const worker = await workerP;
    const task = await base.taskRepo.createTask({ createdBy: 'u1' });
    await base.taskRepo.transitionStatus({ taskId: task.id, to: 'queued' });
    const input = GenericAgentTaskInputSchema.parse({ taskId: task.id, subject: { id: 'u1', roles: ['admin'] } });

    const result = await worker.runUntil(
      env.client.workflow.execute('generic_agent_task_workflow', {
        taskQueue: TASK_QUEUE,
        workflowId: `wf-generic-${task.id}`,
        args: [input],
      }),
    );
    expect(result).toMatchObject({ status: 'completed' });
    expect((await base.taskRepo.getTaskById(task.id))?.status).toBe('completed');
  }, 120_000);

  it('approval pause → resume on signal → completed', async () => {
    const { base, workerP } = makeWorker('wf-2');
    const worker = await workerP;
    const task = await base.taskRepo.createTask({ createdBy: 'u1' });
    await base.taskRepo.transitionStatus({ taskId: task.id, to: 'queued' });
    const input = GenericAgentTaskInputSchema.parse({
      taskId: task.id,
      subject: { id: 'u1', roles: ['admin'] },
      requireApproval: true,
    });

    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start('generic_agent_task_workflow', {
        taskQueue: TASK_QUEUE,
        workflowId: `wf-approval-${task.id}`,
        args: [input],
      });
      await handle.signal('approvalDecision', { approvalId: 'ap1', decision: 'approved' });
      return handle.result();
    });
    expect(result).toMatchObject({ status: 'completed' });
  }, 120_000);
});
