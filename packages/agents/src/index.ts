/**
 * LangGraph.js agent runtime. NODE-ONLY.
 *
 * Агенты действуют ТОЛЬКО через Tool Broker (`@su10/tools`) — с per-agent allowlist
 * (forbidden-tool guard) — и через интерфейс LLM Gateway (`@su10/llm`; реальный
 * клиент LM Studio — этап 8). LangGraph checkpoint НЕ источник бизнес-статуса.
 */
import { createAgentRuntime, type AgentRuntime } from './runtime.js';
import { chatAgent } from './agents/chatAgent.js';
import { ragAgent } from './agents/ragAgent.js';
import { documentExtractionAgent } from './agents/documentExtractionAgent.js';

export * from './runtime.js';
export * from './fakeGateway.js';
export { chatAgent } from './agents/chatAgent.js';
export { ragAgent } from './agents/ragAgent.js';
export { documentExtractionAgent } from './agents/documentExtractionAgent.js';

/** Runtime с тремя базовыми агентами: chat_agent, rag_agent, document_extraction_agent. */
export function createDefaultAgentRuntime(): AgentRuntime {
  return createAgentRuntime([chatAgent(), ragAgent(), documentExtractionAgent()]);
}
