/**
 * LangGraph tool adapter (framework-agnostic — без зависимости `langgraph`).
 * Оборачивает `broker.invoke` в форму, совместимую со StructuredTool-интерфейсом
 * LangGraph (`name`/`description`/`schema`/`invoke`). На шаге 7 это оборачивается
 * в `DynamicStructuredTool` 1:1. Захватывает только (broker, name) — НЕ handler.
 */
import type { ZodTypeAny } from 'zod';
import type { ToolBroker } from '../broker.js';
import type { ToolContext } from '../types.js';

export interface CallableTool {
  name: string;
  description: string;
  schema: ZodTypeAny;
  invoke(input: unknown): Promise<unknown>;
}

export function toLangGraphTool(
  broker: ToolBroker,
  tool: { name: string; description: string; inputSchema: ZodTypeAny },
  ctxFactory: () => ToolContext,
): CallableTool {
  return {
    name: tool.name,
    description: tool.description,
    schema: tool.inputSchema,
    invoke: (input) => broker.invoke(tool.name, input, ctxFactory()),
  };
}
