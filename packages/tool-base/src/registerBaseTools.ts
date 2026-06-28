/** Сборка и регистрация базовых инструментов. Handler'ы наружу НЕ экспортируются. */
import type { ToolDefinition, ToolRegistry } from '@su10/tools';
import type { BaseToolDeps } from './ports.js';
import { taskGetStatusTool } from './tools/taskGetStatus.js';
import { artifactCreateTool } from './tools/artifactCreate.js';
import { approvalRequestTool } from './tools/approvalRequest.js';
import { approvalResolveTool } from './tools/approvalResolve.js';
import { notificationSendTool } from './tools/notificationSend.js';

export function createBaseTools(deps: BaseToolDeps): ToolDefinition[] {
  return [
    taskGetStatusTool(deps),
    artifactCreateTool(deps),
    approvalRequestTool(deps),
    approvalResolveTool(deps),
    notificationSendTool(deps),
  ];
}

export function registerBaseTools(registry: ToolRegistry, deps: BaseToolDeps): void {
  for (const tool of createBaseTools(deps)) registry.register(tool);
}
