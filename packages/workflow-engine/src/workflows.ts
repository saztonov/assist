/**
 * Детерминированные Temporal-workflow. ИЗОЛИРОВАННЫЙ БАНДЛ: импортирует ТОЛЬКО
 * `@temporalio/workflow`, локальные constants/orchestration и типы. БЕЗ node:*,
 * @su10/db, @su10/tools, @su10/llm, IO, рандома — иначе ломается replay.
 *
 * Side effects и смена статуса — исключительно через proxy-activities (реализация
 * в worker-хосте). Этот файл НЕ реэкспортируется из index.ts: его грузит только
 * worker (`workflowsPath`), чтобы consumers (agent-api) не тянули @temporalio/workflow.
 */
import { proxyActivities, defineSignal, setHandler, condition } from '@temporalio/workflow';
import type { AgentTaskActivities } from './activities.js';
import {
  ACTIVITY_RETRY,
  ACTIVITY_TIMEOUTS,
  APPROVAL_DECISION_SIGNAL,
  CANCEL_SIGNAL,
  type ApprovalDecisionPayload,
} from './constants.js';
import {
  runGenericAgentTask,
  runVisualTemplate,
  type AgentTaskOutcome,
  type OrchestrationEnv,
} from './orchestration.js';
import type { GenericAgentTaskInput, VisualTemplateInput } from './contracts.js';

const retry = {
  initialInterval: ACTIVITY_RETRY.initialIntervalMs,
  backoffCoefficient: ACTIVITY_RETRY.backoffCoefficient,
  maximumInterval: ACTIVITY_RETRY.maximumIntervalMs,
  maximumAttempts: ACTIVITY_RETRY.maximumAttempts,
};

const shortAct = proxyActivities<AgentTaskActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.defaultStartToCloseMs,
  retry,
});

const longAct = proxyActivities<Pick<AgentTaskActivities, 'runAgentBlock'>>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.agentStartToCloseMs,
  retry,
});

/** Activities-объект для orchestration: agent-блок с длинным таймаутом, прочее — короткий. */
const activities: AgentTaskActivities = {
  recordTaskStatus: (i) => shortAct.recordTaskStatus(i),
  runToolBlock: (i) => shortAct.runToolBlock(i),
  runAgentBlock: (i) => longAct.runAgentBlock(i),
  createArtifact: (i) => shortAct.createArtifact(i),
  requestApproval: (i) => shortAct.requestApproval(i),
  notifyUser: (i) => shortAct.notifyUser(i),
};

export const approvalDecisionSignal =
  defineSignal<[ApprovalDecisionPayload]>(APPROVAL_DECISION_SIGNAL);
export const cancelWorkflowSignal = defineSignal(CANCEL_SIGNAL);

/** Строит OrchestrationEnv на сигналах + condition (внутри каждого workflow). */
function buildWorkflowEnv(): OrchestrationEnv {
  let cancelRequested = false;
  let decision: 'approved' | 'rejected' | undefined;

  setHandler(cancelWorkflowSignal, () => {
    cancelRequested = true;
  });
  setHandler(approvalDecisionSignal, (payload) => {
    decision = payload.decision;
  });

  return {
    activities,
    // В workflow-сэндбоксе Date детерминирован (патчится Temporal SDK).
    now: () => new Date().toISOString(),
    isCancelRequested: () => cancelRequested,
    async awaitApprovalOrCancel() {
      await condition(() => decision !== undefined || cancelRequested);
      if (cancelRequested) return 'cancelled';
      const d = decision ?? 'rejected';
      decision = undefined;
      return d;
    },
  };
}

export async function generic_agent_task_workflow(
  input: GenericAgentTaskInput,
): Promise<AgentTaskOutcome> {
  return runGenericAgentTask(input, buildWorkflowEnv());
}

export async function visual_template_generic_workflow(
  input: VisualTemplateInput,
): Promise<AgentTaskOutcome> {
  return runVisualTemplate(input, buildWorkflowEnv());
}
