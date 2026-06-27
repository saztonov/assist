/**
 * LangGraph.js agent graphs. NODE-ONLY.
 * Agents may act ONLY through the Tool Broker (@su10/tools). LangGraph checkpoints
 * are internal and are NOT the business-status source of truth.
 */
import type { ToolBroker } from '@su10/tools';

export interface AgentStepInput {
  prompt: string;
}

export interface AgentStepResult {
  output: string;
}

export interface CompiledAgentGraph {
  invoke(input: AgentStepInput): Promise<AgentStepResult>;
}

export interface AgentGraphDefinition {
  name: string;
}

/**
 * Scaffold stub. Real LangGraph.js `StateGraph` wiring is added when the agent
 * runtime is implemented; tool calls will route through the injected broker.
 */
export function createAgentGraph(
  def: AgentGraphDefinition,
  _broker?: ToolBroker,
): CompiledAgentGraph {
  return {
    async invoke(input: AgentStepInput): Promise<AgentStepResult> {
      return { output: `[${def.name}] ${input.prompt}` };
    },
  };
}

export const echoAgent = createAgentGraph({ name: 'echo' });
