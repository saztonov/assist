/**
 * Доступ к agent_runs / agent_steps — исполнительная телеметрия LangGraph-агентов
 * (этап 7). Это НЕ источник бизнес-статуса (он в agent_tasks). Хранятся только
 * метаданные шагов: тип, инструмент, статус, длительность, хэши — без сырья/ПДн.
 */
import { eq } from 'drizzle-orm';
import { agentRuns, agentSteps } from '../schema/agentRuns.js';
import type { Database } from '../index.js';

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type AgentStepRow = typeof agentSteps.$inferSelect;

export interface CreateAgentRunInput {
  taskId?: string | null;
  sessionId?: string | null;
  graphName: string;
}

export interface AppendAgentStepInput {
  runId: string;
  stepIndex: number;
  stepType: string;
  toolName?: string | null;
  status?: string | null;
  inputHash?: string | null;
  outputHash?: string | null;
  durationMs?: number | null;
  /** Только метаданные/коды; без сырья. */
  dataJson?: unknown;
}

export interface FinishAgentRunInput {
  runId: string;
  status: 'completed' | 'failed';
  errorCode?: string | null;
}

export interface AgentRunRepo {
  createRun(input: CreateAgentRunInput): Promise<AgentRunRow>;
  appendStep(input: AppendAgentStepInput): Promise<void>;
  finishRun(input: FinishAgentRunInput): Promise<void>;
}

export function createAgentRunRepo(db: Database): AgentRunRepo {
  return {
    async createRun(input) {
      const [row] = await db
        .insert(agentRuns)
        .values({
          taskId: input.taskId ?? null,
          sessionId: input.sessionId ?? null,
          graphName: input.graphName,
          status: 'running',
          startedAt: new Date(),
        })
        .returning();
      return row;
    },

    async appendStep(input) {
      await db.insert(agentSteps).values({
        runId: input.runId,
        stepIndex: input.stepIndex,
        stepType: input.stepType,
        toolName: input.toolName ?? null,
        status: input.status ?? null,
        inputHash: input.inputHash ?? null,
        outputHash: input.outputHash ?? null,
        durationMs: input.durationMs ?? null,
        dataJson: input.dataJson ?? null,
      });
    },

    async finishRun(input) {
      await db
        .update(agentRuns)
        .set({
          status: input.status,
          completedAt: new Date(),
          errorCode: input.errorCode ?? null,
          updatedAt: new Date(),
        })
        .where(eq(agentRuns.id, input.runId));
    },
  };
}
