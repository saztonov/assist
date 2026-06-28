import { describe, it, expect } from 'vitest';
import { ConflictError, NotFoundError } from '@su10/errors';
import { InMemoryAgentTaskRepo } from './agentTaskRepo.memory.js';

describe('InMemoryAgentTaskRepo: createTask', () => {
  it('создаёт задачу со статусом created и пишет событие created', async () => {
    const repo = new InMemoryAgentTaskRepo();
    const task = await repo.createTask({ createdBy: 'u-1', title: 'T' });
    expect(task.status).toBe('created');
    expect(task.createdBy).toBe('u-1');
    const events = await repo.listEvents(task.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'created', status: 'created' });
  });
});

describe('InMemoryAgentTaskRepo: transitionStatus', () => {
  it('легальный переход меняет статус и добавляет событие', async () => {
    const repo = new InMemoryAgentTaskRepo();
    const t = await repo.createTask({ createdBy: 'u-1' });
    const r = await repo.transitionStatus({
      taskId: t.id,
      to: 'queued',
      workflowId: 'wf-1',
      eventType: 'started',
    });
    expect(r.status).toBe('queued');
    expect(r.workflowId).toBe('wf-1');
    const events = await repo.listEvents(t.id);
    expect(events.map((e) => e.eventType)).toEqual(['created', 'started']);
  });

  it('нелегальный переход → ConflictError, статус не меняется', async () => {
    const repo = new InMemoryAgentTaskRepo();
    const t = await repo.createTask({ createdBy: 'u-1' });
    await expect(repo.transitionStatus({ taskId: t.id, to: 'completed' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await repo.getTaskById(t.id))?.status).toBe('created');
  });

  it('expectedFrom-несовпадение → ConflictError', async () => {
    const repo = new InMemoryAgentTaskRepo();
    const t = await repo.createTask({ createdBy: 'u-1' });
    await expect(
      repo.transitionStatus({ taskId: t.id, to: 'queued', expectedFrom: 'running' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('неизвестная задача → NotFoundError', async () => {
    const repo = new InMemoryAgentTaskRepo();
    await expect(
      repo.transitionStatus({ taskId: 'missing', to: 'queued' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('failed-переход сохраняет errorCode', async () => {
    const repo = new InMemoryAgentTaskRepo();
    const t = await repo.createTask({ createdBy: 'u-1' });
    const r = await repo.transitionStatus({
      taskId: t.id,
      to: 'failed',
      errorCode: 'TEMPORAL_START_FAILED',
    });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('TEMPORAL_START_FAILED');
  });
});

describe('InMemoryAgentTaskRepo: listTasks scope + пагинация', () => {
  it('не-admin видит только свои; admin видит все', async () => {
    const repo = new InMemoryAgentTaskRepo();
    await repo.createTask({ createdBy: 'u-1' });
    await repo.createTask({ createdBy: 'u-2' });
    const own = await repo.listTasks({ requesterId: 'u-1', isAdmin: false, limit: 50 });
    expect(own.items).toHaveLength(1);
    expect(own.items[0].createdBy).toBe('u-1');
    const all = await repo.listTasks({ requesterId: 'admin', isAdmin: true, limit: 50 });
    expect(all.items).toHaveLength(2);
  });

  it('фильтр по статусу', async () => {
    const repo = new InMemoryAgentTaskRepo();
    const a = await repo.createTask({ createdBy: 'u-1' });
    await repo.createTask({ createdBy: 'u-1' });
    await repo.transitionStatus({ taskId: a.id, to: 'queued' });
    const queued = await repo.listTasks({
      requesterId: 'u-1',
      isAdmin: false,
      status: 'queued',
      limit: 50,
    });
    expect(queued.items).toHaveLength(1);
    expect(queued.items[0].id).toBe(a.id);
  });

  it('keyset-пагинация: стабильна и без дублей', async () => {
    const repo = new InMemoryAgentTaskRepo();
    for (let i = 0; i < 5; i++) await repo.createTask({ createdBy: 'u-1' });
    const p1 = await repo.listTasks({ requesterId: 'u-1', isAdmin: false, limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeDefined();
    const p2 = await repo.listTasks({
      requesterId: 'u-1',
      isAdmin: false,
      limit: 2,
      cursor: p1.nextCursor,
    });
    const p3 = await repo.listTasks({
      requesterId: 'u-1',
      isAdmin: false,
      limit: 2,
      cursor: p2.nextCursor,
    });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((t) => t.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.nextCursor).toBeUndefined();
  });
});
