/**
 * Agent worker: исполняет LangGraph-агентов. Инструменты — только через Tool
 * Broker; LLM — только через `@su10/llm` (до этапа 8 — fake gateway). Прогон и шаги
 * пишутся в agent_runs/agent_steps (метаданные/хэши, без сырья).
 *
 * `createAgentBlockRunner` экспонируется как реализация Temporal-activity
 * `runAgentBlock` (этап 6, см. workers/temporal-worker).
 */
import type { AuditSink } from '@su10/audit';
import type { AgentRunRepo } from '@su10/db';
import type { ToolBroker } from '@su10/tools';
import type { LlmGateway } from '@su10/llm';
import {
  createDefaultAgentRuntime,
  type AgentRunContext,
  type AgentRuntime,
  type AgentStepRecorder,
} from '@su10/agents';
import type { RunAgentBlockInput, RunAgentBlockResult } from '@su10/workflow-engine';

export { createFakeLlmGateway, createDefaultAgentRuntime } from '@su10/agents';

/** AgentStepRecorder → agent_steps через agentRunRepo (для конкретного runId). */
export function createDbAgentStepRecorder(runRepo: AgentRunRepo, runId: string): AgentStepRecorder {
  return {
    async record(rec) {
      await runRepo.appendStep({
        runId,
        stepIndex: rec.stepIndex,
        stepType: rec.stepType,
        toolName: rec.toolName ?? null,
        status: rec.status,
        inputHash: rec.inputHash ?? null,
        outputHash: rec.outputHash ?? null,
        durationMs: rec.durationMs,
        ...(rec.redactedErrorCode ? { dataJson: { errorCode: rec.redactedErrorCode } } : {}),
      });
    },
  };
}

export interface AgentBlockRunnerDeps {
  runRepo: AgentRunRepo;
  broker: ToolBroker;
  auditSink: AuditSink;
  llm: LlmGateway;
  /** По умолчанию — три базовых агента. */
  runtime?: AgentRuntime;
}

/**
 * Реализация Temporal-activity `runAgentBlock`: создаёт agent_run, исполняет агента
 * через runtime (tools — только через broker), пишет шаги, финализирует прогон.
 */
export function createAgentBlockRunner(
  deps: AgentBlockRunnerDeps,
): (input: RunAgentBlockInput) => Promise<RunAgentBlockResult> {
  const runtime = deps.runtime ?? createDefaultAgentRuntime();
  return async (input) => {
    const run = await deps.runRepo.createRun({
      taskId: input.taskId,
      graphName: input.agentName,
    });
    const ctx: AgentRunContext = {
      subject: { id: input.subjectId, roles: input.roles },
      broker: deps.broker,
      llm: deps.llm,
      auditSink: deps.auditSink,
      now: () => input.at,
      recorder: createDbAgentStepRecorder(deps.runRepo, run.id),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      agentRunId: run.id,
    };
    try {
      const res = await runtime.runAgentStep(input.agentName, { prompt: input.prompt }, ctx);
      await deps.runRepo.finishRun({ runId: run.id, status: 'completed' });
      return { output: res.output };
    } catch (err) {
      await deps.runRepo.finishRun({ runId: run.id, status: 'failed', errorCode: 'AGENT_RUN_FAILED' });
      throw err;
    }
  };
}
