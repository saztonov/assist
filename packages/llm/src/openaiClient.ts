/**
 * Minimal OpenAI-compatible client for LM Studio. NODE-ONLY.
 *
 * Uses an injectable `fetch` (tests pass a fake → no network). The Bearer token
 * is sent ONLY in the Authorization header and never logged or echoed in errors.
 */
import type { FetchLike } from './types.js';
import {
  authError,
  badResponseError,
  modelNotFoundError,
  timeoutError,
  upstreamError,
} from './errors.js';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface OpenAiChatBody {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
}

export interface OpenAiClientConfig {
  baseUrl: string;
  token: string;
  fetch: FetchLike;
}

export class OpenAiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetch: FetchLike;

  constructor(cfg: OpenAiClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.token = cfg.token;
    this.fetch = cfg.fetch;
  }

  async chatCompletions(body: OpenAiChatBody, timeoutMs: number): Promise<OpenAiChatResponse> {
    const res = await this.send('/chat/completions', 'POST', JSON.stringify(body), timeoutMs, body.model);
    return this.parseJson<OpenAiChatResponse>(res, body.model);
  }

  async models(timeoutMs: number): Promise<OpenAiModelsResponse> {
    const res = await this.send('/models', 'GET', undefined, timeoutMs);
    return this.parseJson<OpenAiModelsResponse>(res);
  }

  private async send(
    path: string,
    method: string,
    body: string | undefined,
    timeoutMs: number,
    model?: string,
  ): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      // Abort or network failure — never include the cause (may carry the URL/token context).
      if ((err as { name?: string })?.name === 'AbortError') throw timeoutError(model ?? 'unknown');
      throw upstreamError(0, model);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) throw authError();
    if (res.status === 404) throw modelNotFoundError(model ?? 'unknown');
    if (res.status >= 500) throw upstreamError(res.status, model);
    // Other 4xx (e.g. 400/413) — treat as non-retryable bad response.
    throw badResponseError(model);
  }

  private async parseJson<T>(
    res: { json(): Promise<unknown> },
    model?: string,
  ): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw badResponseError(model);
    }
  }
}
