import { describe, it, expect } from 'vitest';
import { InMemoryChatRepo } from './chatRepo.memory.js';

describe('InMemoryChatRepo', () => {
  it('создаёт сессию со статусом active и владельцем', async () => {
    const repo = new InMemoryChatRepo();
    const s = await repo.createSession({ userId: 'u-1', title: 'Привет' });
    expect(s.userId).toBe('u-1');
    expect(s.status).toBe('active');
    expect(s.title).toBe('Привет');
  });

  it('listSessions скоупит по владельцу, admin видит все', async () => {
    const repo = new InMemoryChatRepo();
    await repo.createSession({ userId: 'u-1' });
    await repo.createSession({ userId: 'u-2' });

    const own = await repo.listSessions({ requesterId: 'u-1', isAdmin: false, limit: 20 });
    expect(own).toHaveLength(1);
    expect(own[0].userId).toBe('u-1');

    const all = await repo.listSessions({ requesterId: 'admin', isAdmin: true, limit: 20 });
    expect(all).toHaveLength(2);
  });

  it('addMessage сохраняет сообщения по порядку и поднимает updatedAt сессии', async () => {
    const repo = new InMemoryChatRepo();
    const s = await repo.createSession({ userId: 'u-1' });
    const before = s.updatedAt.getTime();

    await repo.addMessage({ sessionId: s.id, role: 'user', content: 'вопрос' });
    await repo.addMessage({ sessionId: s.id, role: 'assistant', content: 'ответ' });

    const msgs = await repo.listMessages(s.id);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs.map((m) => m.content)).toEqual(['вопрос', 'ответ']);

    const updated = await repo.getSession(s.id);
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('listSessions сортирует по активности (последняя обновлённая — первой)', async () => {
    const repo = new InMemoryChatRepo();
    const s1 = await repo.createSession({ userId: 'u-1' });
    const s2 = await repo.createSession({ userId: 'u-1' });
    // Активность в s1 делает её самой свежей.
    await repo.addMessage({ sessionId: s1.id, role: 'user', content: 'x' });

    const list = await repo.listSessions({ requesterId: 'u-1', isAdmin: false, limit: 20 });
    expect(list[0].id).toBe(s1.id);
    expect(list[1].id).toBe(s2.id);
  });
});
