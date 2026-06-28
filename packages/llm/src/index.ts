/**
 * The llm-gateway — the ONLY code path allowed to talk to LM Studio. NODE-ONLY.
 * No browser export. `createLlmGateway` returns `LlmGatewayService` (a superset
 * of the minimal `LlmGateway` the agent runtime depends on).
 */

// Public contracts (chat/embed + richer service surface, provider/model types).
export * from './types.js';
// Dedicated embedding abstraction (separate from chat/vision models).
export * from './embeddingProvider.js';
// Metadata-only call telemetry port.
export * from './recorder.js';
// Typed LLM errors.
export * from './errors.js';
// Pure routing / policy / concurrency primitives.
export * from './modelRouter.js';
export * from './policy.js';
export { Semaphore, createLimiters, type Limiters } from './concurrency.js';
// The gateway factory.
export * from './gateway.js';
