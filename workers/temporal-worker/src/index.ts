/**
 * Temporal Worker host. Registers workflow definitions and injects the concrete
 * activity implementations. Activities are the ONLY place that mutate business
 * status (agent_tasks); the workflow stays deterministic.
 *
 * Scaffold stub: the real `@temporalio/worker` `Worker.create(...)` wiring is
 * added when the Temporal cluster is provisioned. No network I/O here.
 */
import { createLogger } from '@su10/logger';
import { runAgentTaskWorkflow, type Activities } from '@su10/workflow-engine';

const log = createLogger('temporal-worker');

export function createActivities(): Activities {
  return {
    async recordTaskStatus(taskId, status) {
      // Real impl persists to agent_tasks via @su10/db.
      log.info({ taskId, status }, 'agent_tasks status update');
    },
  };
}

export async function runWorker(): Promise<void> {
  const activities = createActivities();
  // Demonstrates the deterministic workflow driven by injected activities.
  await runAgentTaskWorkflow({ taskId: 'demo', templateId: 'demo' }, activities);
}
