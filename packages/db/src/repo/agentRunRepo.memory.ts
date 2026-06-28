/**
 * In-memory `AgentRunRepo` (самостоятельная корректная реализация интерфейса) для
 * DB-free unit/integration тестов — по образцу `InMemoryAgentTaskRepo`.
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentRunRepo,
  AgentRunRow,
  AgentStepRow,
  AppendAgentStepInput,
  CreateAgentRunInput,
  FinishAgentRunInput,
} from './agentRunRepo.js';

export class InMemoryAgentRunRepo implements AgentRunRepo {
  readonly runs: AgentRunRow[] = [];
  readonly steps: AgentStepRow[] = [];
  private seq = 0;

  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1) + this.seq++ * 1000);
  }

  async createRun(input: CreateAgentRunInput): Promise<AgentRunRow> {
    const ts = this.now();
    const row: AgentRunRow = {
      id: randomUUID(),
      taskId: input.taskId ?? null,
      sessionId: input.sessionId ?? null,
      graphName: input.graphName,
      status: 'running',
      startedAt: ts,
      completedAt: null,
      errorCode: null,
      metadataJson: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.runs.push(row);
    return row;
  }

  async appendStep(input: AppendAgentStepInput): Promise<void> {
    this.steps.push({
      id: randomUUID(),
      runId: input.runId,
      stepIndex: input.stepIndex,
      stepType: input.stepType,
      toolName: input.toolName ?? null,
      status: input.status ?? null,
      inputHash: input.inputHash ?? null,
      outputHash: input.outputHash ?? null,
      durationMs: input.durationMs ?? null,
      dataJson: input.dataJson ?? null,
      createdAt: this.now(),
    });
  }

  async finishRun(input: FinishAgentRunInput): Promise<void> {
    const run = this.runs.find((r) => r.id === input.runId);
    if (!run) return;
    run.status = input.status;
    run.completedAt = this.now();
    run.errorCode = input.errorCode ?? null;
    run.updatedAt = this.now();
  }
}
