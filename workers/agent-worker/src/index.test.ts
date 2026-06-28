import { describe, it, expect } from 'vitest';
import { InMemoryAgentRunRepo } from '@su10/db';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import { createAgentBlockRunner, createFakeLlmGateway } from './index.js';

describe('agent-worker runAgentBlock', () => {
  it('runs chat_agent, returns output and records run + steps', async () => {
    const runRepo = new InMemoryAgentRunRepo();
    const runner = createAgentBlockRunner({
      runRepo,
      broker: new ToolBroker(new ToolRegistry()),
      auditSink: new InMemoryAuditSink(),
      llm: createFakeLlmGateway({ chat: () => 'answer' }),
    });

    const res = await runner({
      taskId: 'task-1',
      agentName: 'chat_agent',
      prompt: 'question',
      subjectId: 'u1',
      roles: ['admin'],
      at: '2026-06-28T00:00:00.000Z',
    });

    expect(res.output).toBe('answer');
    expect(runRepo.runs).toHaveLength(1);
    expect(runRepo.runs[0].status).toBe('completed');
    expect(runRepo.steps.map((s) => s.stepType)).toEqual(['llm', 'output']);
    // Метаданные шагов не содержат сырья промпта/ответа.
    expect(JSON.stringify(runRepo.steps)).not.toContain('question');
    expect(JSON.stringify(runRepo.steps)).not.toContain('answer');
  });

  it('marks run failed when the agent throws', async () => {
    const runRepo = new InMemoryAgentRunRepo();
    const runner = createAgentBlockRunner({
      runRepo,
      broker: new ToolBroker(new ToolRegistry()),
      auditSink: new InMemoryAuditSink(),
      // нет инструмента rag.search → rag_agent упадёт в брокере (NotFound).
      llm: createFakeLlmGateway(),
    });

    await expect(
      runner({
        taskId: 'task-2',
        agentName: 'rag_agent',
        prompt: 'q',
        subjectId: 'u1',
        roles: ['admin'],
        at: '2026-06-28T00:00:00.000Z',
      }),
    ).rejects.toBeTruthy();
    expect(runRepo.runs[0].status).toBe('failed');
    expect(runRepo.runs[0].errorCode).toBe('AGENT_RUN_FAILED');
  });
});
