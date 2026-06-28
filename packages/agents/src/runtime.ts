/**
 * AgentRuntime — общий контракт исполнения агентных шагов. NODE-ONLY.
 *
 * Инварианты:
 * - инструменты вызываются ТОЛЬКО через ToolBroker.invoke (+ per-agent allowlist:
 *   forbidden-tool guard отклоняет инструмент вне allowlist ДО брокера);
 * - LLM — ТОЛЬКО через интерфейс `@su10/llm` LlmGateway (реальный клиент — этап 8;
 *   в тестах — fake);
 * - шаги пишутся как метаданные (hashes/ids/коды), без сырья/ПДн;
 * - LangGraph checkpoint НЕ источник бизнес-статуса.
 */
import type { ZodTypeAny } from 'zod';
import { AuthzError, NotFoundError } from '@su10/errors';
import type { Subject } from '@su10/permissions';
import type { AuditSink } from '@su10/audit';
import { hashJson, type ToolBroker, type ToolContext } from '@su10/tools';
import type { LlmGateway } from '@su10/llm';

export interface AgentStepInput {
  prompt: string;
  /** Опц. zod-схема для structured-output агентов (document_extraction). */
  schema?: ZodTypeAny;
}

export interface AgentStepResult {
  output: string;
  /** Структурированный результат (zod-валидированный), если применимо. */
  data?: unknown;
}

export type AgentStepType = 'llm' | 'tool' | 'output';

export interface AgentStepInfo {
  stepType: AgentStepType;
  toolName?: string;
  status: 'success' | 'failure';
  durationMs: number;
  inputHash?: string;
  outputHash?: string;
  redactedErrorCode?: string;
}

export interface AgentStepRecord extends AgentStepInfo {
  agentName: string;
  stepIndex: number;
  at: string;
}

/** Порт персистентности шагов (DB-реализация — `@su10/db` agentRunRepo, этап 7). */
export interface AgentStepRecorder {
  record(rec: AgentStepRecord): Promise<void> | void;
}

export const noopAgentStepRecorder: AgentStepRecorder = { record() {} };

/** Контекст, передаваемый вызывающим (worker/Temporal-activity/agent-api). */
export interface AgentRunContext {
  subject: Subject;
  broker: ToolBroker;
  llm: LlmGateway;
  auditSink: AuditSink;
  /** Детерминированное «сейчас» (ISO) для записи шагов. */
  now(): string;
  recorder?: AgentStepRecorder;
  taskId?: string;
  agentRunId?: string;
}

/** Внутренний контекст агента (обогащён allowlist + recordStep). */
export interface AgentContext extends AgentRunContext {
  allowedTools: ReadonlySet<string>;
  /** Записать шаг (авто stepIndex, штамп agentName/at). No-op без recorder. */
  recordStep(info: AgentStepInfo): Promise<void>;
}

export interface CompiledAgent {
  invoke(input: AgentStepInput): Promise<AgentStepResult>;
}

export interface AgentDefinition {
  name: string;
  /** Инструменты, разрешённые этому агенту (forbidden-tool guard). */
  allowedTools: readonly string[];
  build(ctx: AgentContext): CompiledAgent;
}

export interface AgentRuntime {
  runAgentStep(agentName: string, input: AgentStepInput, ctx: AgentRunContext): Promise<AgentStepResult>;
  streamAgentStep(
    agentName: string,
    input: AgentStepInput,
    ctx: AgentRunContext,
  ): AsyncIterable<string>;
}

/**
 * Forbidden-tool guard + funnel в ToolBroker. Агент НЕ может вызвать инструмент
 * вне своего allowlist (проверка до брокера), а брокер делает ещё и permission/risk.
 */
export async function invokeAgentTool(
  ctx: AgentContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  if (!ctx.allowedTools.has(name)) {
    throw new AuthzError(`Tool "${name}" is not allowed for this agent`);
  }
  const toolCtx: ToolContext = {
    subject: ctx.subject,
    auditSink: ctx.auditSink,
    at: ctx.now(),
    ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
    ...(ctx.agentRunId ? { agentRunId: ctx.agentRunId } : {}),
  };
  return ctx.broker.invoke(name, input, toolCtx);
}

/** Хелпер LLM-вызова с записью шага (метаданные/хэши, без сырья). */
export async function callLlmStep(
  ctx: AgentContext,
  req: Parameters<LlmGateway['chat']>[0],
): Promise<string> {
  const started = Date.now();
  try {
    const res = await ctx.llm.chat(req);
    await ctx.recordStep({
      stepType: 'llm',
      status: 'success',
      durationMs: Date.now() - started,
      inputHash: hashJson({ model: req.model ?? null, n: req.messages.length }),
      outputHash: hashJson(res.content),
    });
    return res.content;
  } catch (err) {
    await ctx.recordStep({
      stepType: 'llm',
      status: 'failure',
      durationMs: Date.now() - started,
      redactedErrorCode: 'LLM_CALL_FAILED',
    });
    throw err;
  }
}

/** Создаёт runtime поверх набора определений агентов. */
export function createAgentRuntime(defs: readonly AgentDefinition[]): AgentRuntime {
  const byName = new Map(defs.map((d) => [d.name, d]));

  const buildContext = (def: AgentDefinition, base: AgentRunContext): AgentContext => {
    let stepIndex = 0;
    const recorder = base.recorder ?? noopAgentStepRecorder;
    return {
      ...base,
      allowedTools: new Set(def.allowedTools),
      async recordStep(info) {
        await recorder.record({ ...info, agentName: def.name, stepIndex: stepIndex++, at: base.now() });
      },
    };
  };

  const runtime: AgentRuntime = {
    async runAgentStep(agentName, input, base) {
      const def = byName.get(agentName);
      if (!def) throw new NotFoundError(`Unknown agent: ${agentName}`);
      const ctx = buildContext(def, base);
      const agent = def.build(ctx);
      const started = Date.now();
      try {
        const res = await agent.invoke(input);
        await ctx.recordStep({
          stepType: 'output',
          status: 'success',
          durationMs: Date.now() - started,
          outputHash: hashJson(res.output),
        });
        return res;
      } catch (err) {
        await ctx.recordStep({
          stepType: 'output',
          status: 'failure',
          durationMs: Date.now() - started,
          redactedErrorCode: 'AGENT_STEP_FAILED',
        });
        throw err;
      }
    },

    async *streamAgentStep(agentName, input, base) {
      // Базовый стрим: один кусок = финальный вывод (реальный токен-стрим — позже).
      const res = await runtime.runAgentStep(agentName, input, base);
      yield res.output;
    },
  };

  return runtime;
}
