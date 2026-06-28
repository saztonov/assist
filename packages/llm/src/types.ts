/**
 * Public contracts for the LLM gateway. NODE-ONLY.
 *
 * The minimal `LlmGateway` (chat/embed) is the surface the agent runtime depends
 * on and MUST stay backward-compatible. `LlmGatewayService` is the richer
 * superset returned by `createLlmGateway`.
 */
import type { z } from 'zod';
import type { EmbeddingProvider } from './embeddingProvider.js';
import type { LlmCallRecorder } from './recorder.js';

// ── Core chat/embed (backward-compatible with the agent runtime) ─────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
}

export interface EmbedRequest {
  input: string[];
  model?: string;
}

export interface EmbedResponse {
  vectors: number[][];
}

export interface LlmGateway {
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
}

// ── Task / model metadata ────────────────────────────────────────────────────

export type TaskKind = 'chat' | 'ocr' | 'extraction' | 'analysis';
export type ModelPurpose = 'chat' | 'ocr' | 'extraction' | 'analysis' | 'embedding';
export type ProviderKind = 'lmstudio' | 'openai_compatible_saas';

export interface VisionImage {
  /** data URL, e.g. `data:image/png;base64,...`. */
  dataUrl: string;
}

export interface ModelInfo {
  id: string;
}

export interface HealthResult {
  status: 'ok' | 'down';
  models?: string[];
  errorCode?: string;
}

// ── Common per-call options ──────────────────────────────────────────────────

export interface CallOptions {
  timeoutMs?: number;
  taskId?: string;
  agentRunId?: string;
}

export interface ChatCompletionRequest extends CallOptions {
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Append `/no_think` (qwen short-task hint). */
  noThink?: boolean;
  purpose?: ModelPurpose;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface OcrRequest extends CallOptions {
  image: VisionImage;
  prompt?: string;
}

export interface ExtractRequest extends CallOptions {
  /** JSON-shaped schema/template guiding extraction. */
  schema: Record<string, unknown>;
  image?: VisionImage;
  text?: string;
  extraInstructions?: string;
}

export interface AnalyzeRequest extends CallOptions {
  text: string;
  task: string;
  maxTokens?: number;
  noThink?: boolean;
}

export interface StructuredOutputRequest<T> extends CallOptions {
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  model?: string;
  maxTokens?: number;
  purpose?: ModelPurpose;
}

// ── Provider abstraction (optional SaaS) ─────────────────────────────────────

export interface ProviderPolicy {
  localOnly: boolean;
  cloudAllowed: boolean;
  sensitiveDataPolicy: 'block' | 'allow' | 'redact';
}

export interface LlmProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly policy: ProviderPolicy;
}

// ── Gateway configuration / dependencies ─────────────────────────────────────

export interface LlmGatewayConfig {
  baseUrl: string;
  token: string;
  models: { chandra: string; lift: string; qwen: string };
  defaults: { chat: string; ocr: string; extraction: string };
  concurrency: { chandra: number; lift: number; qwen: number };
  timeoutMs: number;
  maxRetries: number;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface LlmGatewayDeps {
  fetch?: FetchLike;
  recorder?: LlmCallRecorder;
  embeddingProvider?: EmbeddingProvider;
  /** Monotonic clock for durations (injectable for deterministic tests). */
  now?: () => number;
  /** Delay between retries (injectable to keep tests instant). */
  sleep?: (ms: number) => Promise<void>;
}

export interface LlmGatewayService extends LlmGateway {
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
  ocrImageToMarkdown(req: OcrRequest): Promise<string>;
  extractStructuredJson(req: ExtractRequest): Promise<unknown>;
  analyzeLongContext(req: AnalyzeRequest): Promise<string>;
  structuredOutput<T>(req: StructuredOutputRequest<T>): Promise<T>;
  embeddings(texts: string[]): Promise<EmbedResponse>;
  healthCheck(): Promise<HealthResult>;
  listModels(): Promise<ModelInfo[]>;
}
