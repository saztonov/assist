/**
 * The llm-gateway — the ONLY code path allowed to talk to LM Studio. NODE-ONLY.
 *
 * Responsibilities: model routing, per-model concurrency, bounded retry, typed
 * errors, metadata-only call telemetry. Never logs tokens/prompts/documents.
 */
import { createHash } from 'node:crypto';
import type {
  AnalyzeRequest,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ExtractRequest,
  FetchLike,
  HealthResult,
  LlmGatewayConfig,
  LlmGatewayDeps,
  LlmGatewayService,
  ModelInfo,
  ModelPurpose,
  OcrRequest,
  StructuredOutputRequest,
} from './types.js';
import { OpenAiClient, type OpenAiMessage } from './openaiClient.js';
import { bucketForModel, modelForPurpose } from './modelRouter.js';
import { createLimiters, type Limiters } from './concurrency.js';
import {
  emptyContentError,
  invalidJsonError,
  isRetryableLlmError,
  LLM_ERROR_CODES,
  LlmGatewayError,
  noEmbeddingProviderError,
} from './errors.js';
import { noopLlmCallRecorder, type LlmCallRecorder } from './recorder.js';

const DEFAULT_OCR_PROMPT =
  'Распознай весь текст на изображении. Сохрани структуру документа, заголовки, таблицы, ' +
  'списки и числовые значения. Верни результат в Markdown без лишних комментариев.';

const ANALYZE_SYSTEM =
  'Ты аналитическая модель. Отвечай точно и структурированно. Не придумывай данные. ' +
  'Если данных недостаточно, прямо укажи это.';

interface RawChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  purpose: ModelPurpose;
  taskId?: string;
  agentRunId?: string;
}

export function createLlmGateway(
  config: LlmGatewayConfig,
  deps: LlmGatewayDeps = {},
): LlmGatewayService {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const client = new OpenAiClient({ baseUrl: config.baseUrl, token: config.token, fetch: fetchImpl });
  const limiters: Limiters = createLimiters(config.concurrency);
  const recorder: LlmCallRecorder = deps.recorder ?? noopLlmCallRecorder;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= config.maxRetries || !isRetryableLlmError(err)) throw err;
        attempt++;
        await sleep(Math.min(10_000, 1000 * attempt));
      }
    }
  }

  async function record(
    status: 'success' | 'error',
    model: string,
    purpose: ModelPurpose,
    started: number,
    extra: { promptHash?: string; inputTokens?: number; outputTokens?: number; errorCode?: string },
    opts: RawChatOptions,
  ): Promise<void> {
    await recorder.record({
      providerId: 'lmstudio',
      modelId: model,
      purpose,
      status,
      durationMs: now() - started,
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
      ...(opts.agentRunId ? { agentRunId: opts.agentRunId } : {}),
      ...(extra.promptHash ? { promptHash: extra.promptHash } : {}),
      ...(extra.inputTokens !== undefined ? { inputTokens: extra.inputTokens } : {}),
      ...(extra.outputTokens !== undefined ? { outputTokens: extra.outputTokens } : {}),
      ...(extra.errorCode ? { redactedErrorCode: extra.errorCode } : {}),
    });
  }

  /** Core call: limiter → bounded retry → parse → empty-check → telemetry. */
  async function rawChat(
    model: string,
    messages: OpenAiMessage[],
    opts: RawChatOptions,
  ): Promise<ChatCompletionResult> {
    const body = {
      model,
      messages,
      temperature: opts.temperature ?? 0,
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    };
    const promptHash = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
    const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
    const bucket = bucketForModel(model, config.models);
    const exec = () => withRetry(() => client.chatCompletions(body, timeoutMs));
    const started = now();
    try {
      const resp = bucket ? await limiters[bucket].run(exec) : await exec();
      const content = resp.choices?.[0]?.message?.content ?? '';
      if (!content) {
        await record('error', model, opts.purpose, started, { promptHash, errorCode: LLM_ERROR_CODES.EMPTY_CONTENT }, opts);
        throw emptyContentError(model);
      }
      const inputTokens = resp.usage?.prompt_tokens;
      const outputTokens = resp.usage?.completion_tokens;
      await record('success', model, opts.purpose, started, { promptHash, inputTokens, outputTokens }, opts);
      return { content, model, inputTokens, outputTokens };
    } catch (err) {
      if (!(err instanceof LlmGatewayError && err.code === LLM_ERROR_CODES.EMPTY_CONTENT)) {
        const errorCode = err instanceof LlmGatewayError ? err.code : LLM_ERROR_CODES.UPSTREAM;
        await record('error', model, opts.purpose, started, { promptHash, errorCode }, opts);
      }
      throw err;
    }
  }

  async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const purpose = req.purpose ?? 'chat';
    const model = req.model ?? modelForPurpose(purpose, config);
    const messages = toOpenAiText(applyNoThink(req.messages, req.noThink));
    return rawChat(model, messages, {
      purpose,
      temperature: req.temperature,
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.agentRunId ? { agentRunId: req.agentRunId } : {}),
    });
  }

  async function ocrImageToMarkdown(req: OcrRequest): Promise<string> {
    const model = config.defaults.ocr;
    const messages: OpenAiMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: req.prompt ?? DEFAULT_OCR_PROMPT },
          { type: 'image_url', image_url: { url: req.image.dataUrl } },
        ],
      },
    ];
    const res = await rawChat(model, messages, {
      purpose: 'ocr',
      temperature: 0,
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.agentRunId ? { agentRunId: req.agentRunId } : {}),
    });
    return res.content;
  }

  async function extractStructuredJson(req: ExtractRequest): Promise<unknown> {
    const model = config.defaults.extraction;
    const prompt = buildLiftPrompt(req.schema, req.extraInstructions);
    const content: OpenAiMessage['content'] = req.image
      ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: req.image.dataUrl } },
        ]
      : `${prompt}\n\nДокумент:\n${req.text ?? ''}`;
    const res = await rawChat(model, [{ role: 'user', content }], {
      purpose: 'extraction',
      temperature: 0,
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.agentRunId ? { agentRunId: req.agentRunId } : {}),
    });
    return parseJsonOrThrow(res.content, model);
  }

  async function analyzeLongContext(req: AnalyzeRequest): Promise<string> {
    const model = config.defaults.chat;
    const system = ANALYZE_SYSTEM + (req.noThink ? ' /no_think' : '');
    const userTask = req.task + (req.noThink ? ' /no_think' : '');
    const messages: OpenAiMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: `${userTask}\n\nДанные:\n${req.text}` },
    ];
    const res = await rawChat(model, messages, {
      purpose: 'analysis',
      temperature: 0.2,
      maxTokens: req.maxTokens ?? 4096,
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.agentRunId ? { agentRunId: req.agentRunId } : {}),
    });
    return res.content;
  }

  async function structuredOutput<T>(req: StructuredOutputRequest<T>): Promise<T> {
    const purpose = req.purpose ?? 'extraction';
    const model = req.model ?? modelForPurpose(purpose, config);
    const res = await rawChat(model, toOpenAiText(req.messages), {
      purpose,
      temperature: 0,
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.agentRunId ? { agentRunId: req.agentRunId } : {}),
    });
    return req.schema.parse(parseJsonOrThrow(res.content, model));
  }

  async function embeddings(texts: string[]): Promise<EmbedResponse> {
    const provider = deps.embeddingProvider;
    if (!provider) throw noEmbeddingProviderError();
    const started = now();
    try {
      const vectors = await provider.embed(texts);
      await recorder.record({
        providerId: provider.providerId,
        modelId: provider.model,
        purpose: 'embedding',
        status: 'success',
        durationMs: now() - started,
      });
      return { vectors };
    } catch (err) {
      await recorder.record({
        providerId: provider.providerId,
        modelId: provider.model,
        purpose: 'embedding',
        status: 'error',
        durationMs: now() - started,
        redactedErrorCode: 'EMBEDDING_FAILED',
      });
      throw err;
    }
  }

  async function healthCheck(): Promise<HealthResult> {
    try {
      const res = await client.models(config.timeoutMs);
      const models = (res.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
      return { status: 'ok', models };
    } catch (err) {
      return { status: 'down', errorCode: err instanceof LlmGatewayError ? err.code : LLM_ERROR_CODES.UPSTREAM };
    }
  }

  async function listModels(): Promise<ModelInfo[]> {
    const res = await client.models(config.timeoutMs);
    return (res.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id }));
  }

  // Backward-compatible minimal surface used by the agent runtime.
  const chat = async (req: ChatRequest): Promise<ChatResponse> => {
    const res = await chatCompletion({
      messages: req.messages,
      ...(req.model ? { model: req.model } : {}),
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    });
    return { content: res.content };
  };
  const embed = (req: EmbedRequest): Promise<EmbedResponse> => embeddings(req.input);

  return {
    chat,
    embed,
    chatCompletion,
    ocrImageToMarkdown,
    extractStructuredJson,
    analyzeLongContext,
    structuredOutput,
    embeddings,
    healthCheck,
    listModels,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function applyNoThink(messages: ChatMessage[], noThink?: boolean): ChatMessage[] {
  if (!noThink) return messages;
  const out = messages.map((m) => ({ ...m }));
  const lastUser = [...out].reverse().find((m) => m.role === 'user');
  if (lastUser) lastUser.content = `${lastUser.content} /no_think`;
  const hasSystem = out.some((m) => m.role === 'system');
  if (!hasSystem) out.unshift({ role: 'system', content: '/no_think' });
  return out;
}

function toOpenAiText(messages: ChatMessage[]): OpenAiMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function buildLiftPrompt(schema: Record<string, unknown>, extra?: string): string {
  const schemaText = JSON.stringify(schema, null, 2);
  let prompt = [
    'Извлеки данные из документа строго по указанной JSON-схеме.',
    '',
    'Правила:',
    '1. Верни только валидный JSON.',
    '2. Не добавляй Markdown, пояснения, комментарии или текст вне JSON.',
    '3. Если значение не найдено, верни null.',
    '4. Если список или таблица не найдены, верни пустой массив [].',
    '5. Не придумывай данные.',
    '',
    'JSON-схема:',
    schemaText,
  ].join('\n');
  if (extra) prompt += `\n\nДополнительные инструкции:\n${extra.trim()}`;
  return prompt;
}

/** Strips ```json fences then JSON.parses; throws a typed error on failure. */
function parseJsonOrThrow(raw: string, model: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw invalidJsonError(model);
  }
}
