/**
 * Visual builder block adapter. Маппит узел WorkflowTemplate ({toolRef, params})
 * в `broker.invoke`. Visual Builder (шаг 11) сохраняет шаблон; исполнение узла
 * (шаг 6) идёт через брокер — никаких прямых вызовов handler.
 */
import { ValidationError } from '@su10/errors';
import type { WorkflowNode } from '@su10/workflow-schema';
import type { ToolBroker } from '../broker.js';
import type { ToolContext } from '../types.js';

export async function runWorkflowNode(
  broker: ToolBroker,
  node: WorkflowNode,
  ctx: ToolContext,
): Promise<unknown> {
  if (!node.toolRef) {
    throw new ValidationError('Workflow node has no toolRef', { nodeId: node.id });
  }
  return broker.invoke(node.toolRef, node.params, ctx);
}
