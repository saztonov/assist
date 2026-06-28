/**
 * Чистая логика оркестрации AgentTask (DETERMINISTIC, БЕЗ Temporal/IO).
 *
 * Это «мозг» обоих workflow, отделённый от Temporal-примитивов: side effects идут
 * через инжектируемый `AgentTaskActivities`, а approval/cancel — через инжектируемый
 * `OrchestrationEnv` (в реальном workflow реализован сигналами + `condition`; в
 * тестах — фейками). Так логика покрывается offline-юнит-тестами без живого кластера.
 *
 * Владение статусом: workflow двигает queued→running, running↔waiting_for_approval,
 * →completed/failed через `recordTaskStatus`. Переход →cancelled принадлежит
 * HTTP-слою (`POST /agent/tasks/:id/cancel`), поэтому при отмене orchestration
 * просто корректно останавливается, НЕ выполняя смену статуса (без двойного перехода).
 */
import type {
  AgentTaskActivities,
  RunToolBlockInput,
} from './activities.js';
import type { GenericAgentTaskInput, VisualTemplateInput } from './contracts.js';

export type ApprovalOutcome = 'approved' | 'rejected' | 'cancelled';

export interface OrchestrationEnv {
  activities: AgentTaskActivities;
  /** Детерминированное «сейчас» (workflow: Date-safe; тест: фиксированные часы). */
  now(): string;
  /** Ждёт решения approval ИЛИ отмены (workflow: condition по сигналам). */
  awaitApprovalOrCancel(): Promise<ApprovalOutcome>;
  /** Запрошена ли отмена между шагами. */
  isCancelRequested(): boolean;
}

export interface AgentTaskOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  output?: string;
  errorCode?: string;
}

const CANCELLED: AgentTaskOutcome = { status: 'cancelled' };

/** Общий approval-гейт: request → wait → (running | failed | cancelled). */
async function runApprovalGate(
  env: OrchestrationEnv,
  args: { taskId: string; subjectId: string; action: string; riskLevel: 'low' | 'medium' | 'high' },
): Promise<{ proceed: boolean; outcome?: AgentTaskOutcome }> {
  const { activities: act } = env;
  await act.requestApproval({
    taskId: args.taskId,
    subjectId: args.subjectId,
    action: args.action,
    riskLevel: args.riskLevel,
    at: env.now(),
  });
  const decision = await env.awaitApprovalOrCancel();
  if (decision === 'cancelled') return { proceed: false, outcome: CANCELLED };
  if (decision === 'rejected') {
    await act.recordTaskStatus({
      taskId: args.taskId,
      to: 'failed',
      eventType: 'approval_rejected',
      errorCode: 'APPROVAL_REJECTED',
    });
    return { proceed: false, outcome: { status: 'failed', errorCode: 'APPROVAL_REJECTED' } };
  }
  await act.recordTaskStatus({
    taskId: args.taskId,
    to: 'running',
    eventType: 'approval_granted',
  });
  return { proceed: true };
}

/** generic_agent_task_workflow: (approval?) → agent block → completed. */
export async function runGenericAgentTask(
  input: GenericAgentTaskInput,
  env: OrchestrationEnv,
): Promise<AgentTaskOutcome> {
  const { activities: act } = env;
  await act.recordTaskStatus({ taskId: input.taskId, to: 'running', eventType: 'workflow_started' });
  if (env.isCancelRequested()) return CANCELLED;

  if (input.requireApproval) {
    const gate = await runApprovalGate(env, {
      taskId: input.taskId,
      subjectId: input.subject.id,
      action: input.agentName,
      riskLevel: input.approvalRiskLevel,
    });
    if (!gate.proceed) return gate.outcome!;
  }

  try {
    const result = await act.runAgentBlock({
      taskId: input.taskId,
      agentName: input.agentName,
      prompt: input.prompt,
      subjectId: input.subject.id,
      roles: input.subject.roles,
      at: env.now(),
    });
    if (env.isCancelRequested()) return CANCELLED;
    await act.recordTaskStatus({
      taskId: input.taskId,
      to: 'completed',
      eventType: 'workflow_completed',
      resultJson: { agentName: input.agentName },
    });
    return { status: 'completed', output: result.output };
  } catch {
    await act.recordTaskStatus({
      taskId: input.taskId,
      to: 'failed',
      eventType: 'workflow_failed',
      errorCode: 'AGENT_BLOCK_FAILED',
    });
    return { status: 'failed', errorCode: 'AGENT_BLOCK_FAILED' };
  }
}

/**
 * visual_template_generic_workflow: исполняет узлы WorkflowTemplate JSON.
 * Узлы-триггеры — no-op; `agent` → runAgentBlock; `approval` → approval-гейт;
 * прочее трактуется как tool-блок (`toolRef`) → runToolBlock (через ToolBroker).
 */
export async function runVisualTemplate(
  input: VisualTemplateInput,
  env: OrchestrationEnv,
): Promise<AgentTaskOutcome> {
  const { activities: act } = env;
  await act.recordTaskStatus({ taskId: input.taskId, to: 'running', eventType: 'workflow_started' });

  for (const node of input.template.nodes) {
    if (env.isCancelRequested()) return CANCELLED;
    const type = node.type.toLowerCase();

    if (type.includes('trigger')) continue;

    if (type === 'agent') {
      await act.runAgentBlock({
        taskId: input.taskId,
        agentName: node.toolRef ?? String(node.params.agentName ?? 'chat_agent'),
        prompt: String(node.params.prompt ?? ''),
        subjectId: input.subject.id,
        roles: input.subject.roles,
        at: env.now(),
      });
      continue;
    }

    if (type === 'approval') {
      const gate = await runApprovalGate(env, {
        taskId: input.taskId,
        subjectId: input.subject.id,
        action: node.toolRef ?? 'approval',
        riskLevel: 'high',
      });
      if (!gate.proceed) return gate.outcome!;
      continue;
    }

    // tool-блок: имя инструмента = toolRef (или type), params — вход.
    const toolName = node.toolRef ?? node.type;
    const toolInput: RunToolBlockInput = {
      name: toolName,
      input: node.params,
      subjectId: input.subject.id,
      roles: input.subject.roles,
      at: env.now(),
      taskId: input.taskId,
      idempotencyKey: `${input.taskId}:${node.id}`,
    };
    await act.runToolBlock(toolInput);
  }

  await act.recordTaskStatus({ taskId: input.taskId, to: 'completed', eventType: 'workflow_completed' });
  return { status: 'completed' };
}
