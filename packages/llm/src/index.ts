/**
 * The llm-gateway core — the ONLY code path allowed to talk to LM Studio.
 * NODE-ONLY. No browser export. Scaffold stub performs no network I/O.
 */

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

export interface LlmGatewayConfig {
  baseUrl: string;
  token: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export function createLlmGateway(_cfg: LlmGatewayConfig): LlmGateway {
  // Real implementation: OpenAI-compatible client pointed at LM Studio, with
  // timeouts, max-token caps, per-call audit and prompt/response redaction.
  return {
    async chat(): Promise<ChatResponse> {
      throw new Error('LLM gateway not implemented in scaffold');
    },
    async embed(): Promise<EmbedResponse> {
      throw new Error('LLM gateway not implemented in scaffold');
    },
  };
}
