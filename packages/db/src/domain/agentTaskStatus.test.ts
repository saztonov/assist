import { describe, it, expect } from 'vitest';
import { ConflictError } from '@su10/errors';
import {
  AGENT_TASK_STATUSES,
  ALLOWED_TRANSITIONS,
  AgentTaskStatusSchema,
  assertTransition,
  canTransition,
  isTerminal,
  TERMINAL_STATUSES,
  type AgentTaskStatus,
} from './agentTaskStatus.js';

describe('agentTaskStatus: enum', () => {
  it('содержит ровно 7 контрактных статусов', () => {
    expect([...AGENT_TASK_STATUSES]).toEqual([
      'created',
      'queued',
      'running',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('schema отклоняет неизвестный статус', () => {
    expect(AgentTaskStatusSchema.safeParse('pending').success).toBe(false);
    expect(AgentTaskStatusSchema.safeParse('created').success).toBe(true);
  });
});

describe('agentTaskStatus: терминальность', () => {
  it('completed/failed/cancelled — терминальные, без исходящих', () => {
    for (const s of ['completed', 'failed', 'cancelled'] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(ALLOWED_TRANSITIONS[s]).toEqual([]);
    }
    expect(TERMINAL_STATUSES.size).toBe(3);
  });

  it('нетерминальные имеют исходящие переходы', () => {
    for (const s of ['created', 'queued', 'running', 'waiting_for_approval'] as const) {
      expect(isTerminal(s)).toBe(false);
      expect(ALLOWED_TRANSITIONS[s].length).toBeGreaterThan(0);
    }
  });
});

describe('agentTaskStatus: матрица переходов', () => {
  const legal: Array<[AgentTaskStatus, AgentTaskStatus]> = [
    ['created', 'queued'],
    ['created', 'failed'],
    ['created', 'cancelled'],
    ['queued', 'running'],
    ['queued', 'cancelled'],
    ['running', 'waiting_for_approval'],
    ['running', 'completed'],
    ['waiting_for_approval', 'running'],
    ['waiting_for_approval', 'completed'],
    ['waiting_for_approval', 'cancelled'],
  ];
  const illegal: Array<[AgentTaskStatus, AgentTaskStatus]> = [
    ['created', 'running'],
    ['created', 'completed'],
    ['queued', 'completed'],
    ['completed', 'running'],
    ['failed', 'queued'],
    ['cancelled', 'running'],
    ['completed', 'cancelled'],
  ];

  for (const [from, to] of legal) {
    it(`легальный: ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    });
  }

  for (const [from, to] of illegal) {
    it(`нелегальный: ${from} → ${to} → ConflictError(409)`, () => {
      expect(canTransition(from, to)).toBe(false);
      try {
        assertTransition(from, to);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        expect((err as ConflictError).httpStatus).toBe(409);
      }
    });
  }
});
