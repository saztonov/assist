/**
 * Agent worker: executes LangGraph.js reasoning/tool-calling steps.
 * Tools are invoked only via the Tool Broker; the LLM only via @su10/llm.
 */
import { createLogger } from '@su10/logger';
import { echoAgent } from '@su10/agents';

const log = createLogger('agent-worker');

export interface AgentJob {
  prompt: string;
}

export async function runAgentStep(job: AgentJob): Promise<string> {
  const result = await echoAgent.invoke({ prompt: job.prompt });
  log.debug({ prompt: job.prompt }, 'agent step executed');
  return result.output;
}
