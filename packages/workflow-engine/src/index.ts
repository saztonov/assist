/**
 * Temporal workflow + activity definitions. NODE-ONLY.
 *
 * The workflow is deterministic and performs NO DB/S3/HTTP itself — side effects
 * (incl. updating agent_tasks, the status source of truth) happen in activities
 * whose implementations are INJECTED by the worker host. This keeps workflow
 * code free of heavy deps and preserves an acyclic dependency graph.
 *
 * Real @temporalio/workflow `proxyActivities` wiring is added when the Temporal
 * cluster is provisioned; the injected-activities shape below is what it targets.
 */

export * from './temporalPort.js';

export interface AgentTaskActivities {
  recordTaskStatus(taskId: string, status: string): Promise<void>;
}

export type Activities = AgentTaskActivities;

export interface RunAgentTaskInput {
  taskId: string;
  templateId: string;
}

export async function runAgentTaskWorkflow(
  input: RunAgentTaskInput,
  activities: AgentTaskActivities,
): Promise<string> {
  await activities.recordTaskStatus(input.taskId, 'running');
  await activities.recordTaskStatus(input.taskId, 'completed');
  return input.taskId;
}
