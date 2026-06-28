import { describe, it, expect } from 'vitest';
import { createLlmGateway } from './gateway.js';
import { InMemoryLlmCallRecorder } from './recorder.js';
import { createMockEmbeddingProvider } from './embeddingProvider.js';
import { LLM_ERROR_CODES, LlmGatewayError } from './errors.js';
import type { FetchLike, LlmGatewayConfig } from './types.js';

const TOKEN = 'SECRET-LMSTUDIO-TOKEN';

const cfg: LlmGatewayConfig = {
  baseUrl: 'http://lm-studio:1234/v1',
  token: TOKEN,
  models: { chandra: 'chandra-ocr-2', lift: 'lift', qwen: 'qwen36-27b-mtp' },
  defaults: { chat: 'qwen36-27b-mtp', ocr: 'chandra-ocr-2', extraction: 'lift' },
  concurrency: { chandra: 4, lift: 4, qwen: 1 },
  timeoutMs: 1000,
  maxRetries: 2,
};

interface Resp {
  status?: number;
  body?: unknown;
  invalidJson?: boolean;
}

function jsonResp(r: Resp) {
  const status = r.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      if (r.invalidJson) throw new Error('bad json');
      return r.body ?? {};
    },
    async text(): Promise<string> {
      return typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    },
  };
}

interface Call {
  url: string;
  init?: Parameters<FetchLike>[1];
}

function makeFetch(handler: (url: string, n: number) => Resp): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return jsonResp(handler(url, calls.length));
  };
  return { fetch, calls };
}

const chatOk = (content: string): Resp => ({
  body: { choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 5 } },
});

describe('llm gateway — routing', () => {
  it('routes OCR to chandra, extraction to lift, analysis/chat to qwen', async () => {
    const { fetch, calls } = makeFetch(() => chatOk('{"a":1}'));
    const gw = createLlmGateway(cfg, { fetch });

    await gw.ocrImageToMarkdown({ image: { dataUrl: 'data:image/png;base64,AAAA' } });
    await gw.extractStructuredJson({ schema: { a: null }, text: 'doc' });
    await gw.analyzeLongContext({ text: 'long', task: 'summarize' });
    await gw.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const models = calls.map((c) => JSON.parse(c.init?.body ?? '{}').model);
    expect(models).toEqual(['chandra-ocr-2', 'lift', 'qwen36-27b-mtp', 'qwen36-27b-mtp']);
  });

  it('sends the Bearer token in the Authorization header', async () => {
    const { fetch, calls } = makeFetch(() => chatOk('ok'));
    await createLlmGateway(cfg, { fetch }).chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0].init?.headers?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('applies /no_think to the last user message when requested', async () => {
    const { fetch, calls } = makeFetch(() => chatOk('ok'));
    await createLlmGateway(cfg, { fetch }).analyzeLongContext({
      text: 't',
      task: 'q',
      noThink: true,
    });
    const body = JSON.parse(calls[0].init?.body ?? '{}');
    const lastUser = body.messages.at(-1);
    expect(lastUser.content).toContain('/no_think');
  });
});

describe('llm gateway — content handling', () => {
  it('returns choices[0].message.content as the canonical answer', async () => {
    const { fetch } = makeFetch(() => chatOk('hello world'));
    const res = await createLlmGateway(cfg, { fetch }).chatCompletion({
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.content).toBe('hello world');
    expect(res.model).toBe('qwen36-27b-mtp');
    expect(res.outputTokens).toBe(5);
  });

  it('throws LLM_EMPTY_CONTENT when qwen returns empty content', async () => {
    const { fetch } = makeFetch(() => ({ body: { choices: [{ message: { content: '' } }] } }));
    await expect(
      createLlmGateway(cfg, { fetch }).chatCompletion({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: LLM_ERROR_CODES.EMPTY_CONTENT });
  });

  it('throws LLM_INVALID_JSON when lift returns non-JSON', async () => {
    const { fetch } = makeFetch(() => chatOk('not really json'));
    await expect(
      createLlmGateway(cfg, { fetch }).extractStructuredJson({ schema: {}, text: 'd' }),
    ).rejects.toMatchObject({ code: LLM_ERROR_CODES.INVALID_JSON });
  });

  it('strips ```json fences before parsing extraction output', async () => {
    const { fetch } = makeFetch(() => chatOk('```json\n{"n":7}\n```'));
    const out = await createLlmGateway(cfg, { fetch }).extractStructuredJson({ schema: {}, text: 'd' });
    expect(out).toEqual({ n: 7 });
  });
});

describe('llm gateway — error mapping & retry', () => {
  it('maps 401 → LLM_AUTH_FAILED (no retry)', async () => {
    const { fetch, calls } = makeFetch(() => ({ status: 401 }));
    await expect(
      createLlmGateway(cfg, { fetch, sleep: async () => {} }).chat({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: LLM_ERROR_CODES.AUTH });
    expect(calls).toHaveLength(1);
  });

  it('maps 404 → LLM_MODEL_NOT_FOUND', async () => {
    const { fetch } = makeFetch(() => ({ status: 404 }));
    await expect(
      createLlmGateway(cfg, { fetch }).chat({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: LLM_ERROR_CODES.MODEL_NOT_FOUND });
  });

  it('retries 5xx up to maxRetries then throws LLM_UPSTREAM', async () => {
    const { fetch, calls } = makeFetch(() => ({ status: 503 }));
    await expect(
      createLlmGateway(cfg, { fetch, sleep: async () => {} }).chat({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: LLM_ERROR_CODES.UPSTREAM });
    expect(calls).toHaveLength(cfg.maxRetries + 1);
  });

  it('recovers when a transient 5xx is followed by success', async () => {
    const { fetch } = makeFetch((_u, n) => (n === 1 ? { status: 500 } : chatOk('recovered')));
    const res = await createLlmGateway(cfg, { fetch, sleep: async () => {} }).chatCompletion({
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.content).toBe('recovered');
  });
});

describe('llm gateway — no secret/prompt leakage', () => {
  it('never includes the token in the thrown error', async () => {
    const { fetch } = makeFetch(() => ({ status: 401 }));
    try {
      await createLlmGateway(cfg, { fetch, sleep: async () => {} }).chat({
        messages: [{ role: 'user', content: 'super secret prompt' }],
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmGatewayError);
      const serialized = JSON.stringify((err as LlmGatewayError).toPublic('corr'));
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain('super secret prompt');
    }
  });
});

describe('llm gateway — telemetry (metadata only)', () => {
  it('records a success event with model + promptHash, no raw content', async () => {
    const recorder = new InMemoryLlmCallRecorder();
    const { fetch } = makeFetch(() => chatOk('answer body'));
    await createLlmGateway(cfg, { fetch, recorder }).chat({
      messages: [{ role: 'user', content: 'a question' }],
    });
    expect(recorder.events).toHaveLength(1);
    const ev = recorder.events[0];
    expect(ev.status).toBe('success');
    expect(ev.modelId).toBe('qwen36-27b-mtp');
    expect(ev.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(ev)).not.toContain('a question');
    expect(JSON.stringify(ev)).not.toContain('answer body');
  });

  it('records an error event with a redacted error code', async () => {
    const recorder = new InMemoryLlmCallRecorder();
    const { fetch } = makeFetch(() => ({ status: 401 }));
    await createLlmGateway(cfg, { fetch, recorder, sleep: async () => {} })
      .chat({ messages: [{ role: 'user', content: 'x' }] })
      .catch(() => {});
    expect(recorder.events[0]).toMatchObject({ status: 'error', redactedErrorCode: LLM_ERROR_CODES.AUTH });
  });
});

describe('llm gateway — concurrency', () => {
  it('serializes qwen calls (max parallel 1)', async () => {
    let active = 0;
    let peak = 0;
    const fetch: FetchLike = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return jsonResp(chatOk('ok'));
    };
    const gw = createLlmGateway(cfg, { fetch });
    await Promise.all([
      gw.chat({ messages: [{ role: 'user', content: 'a' }] }),
      gw.chat({ messages: [{ role: 'user', content: 'b' }] }),
      gw.chat({ messages: [{ role: 'user', content: 'c' }] }),
    ]);
    expect(peak).toBe(1);
  });

  it('allows chandra calls to run in parallel (max parallel 4)', async () => {
    let active = 0;
    let peak = 0;
    const fetch: FetchLike = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return jsonResp(chatOk('md'));
    };
    const gw = createLlmGateway(cfg, { fetch });
    await Promise.all(
      [0, 1, 2].map(() => gw.ocrImageToMarkdown({ image: { dataUrl: 'data:image/png;base64,A' } })),
    );
    expect(peak).toBeGreaterThan(1);
  });
});

describe('llm gateway — embeddings & health', () => {
  it('produces embeddings via the injected EmbeddingProvider', async () => {
    const { fetch } = makeFetch(() => chatOk('x'));
    const gw = createLlmGateway(cfg, { fetch, embeddingProvider: createMockEmbeddingProvider({ dim: 768 }) });
    const out = await gw.embeddings(['hello', 'world']);
    expect(out.vectors).toHaveLength(2);
    expect(out.vectors[0]).toHaveLength(768);
  });

  it('throws when no embedding provider is configured', async () => {
    const { fetch } = makeFetch(() => chatOk('x'));
    await expect(createLlmGateway(cfg, { fetch }).embeddings(['a'])).rejects.toMatchObject({
      code: LLM_ERROR_CODES.NO_EMBEDDING_PROVIDER,
    });
  });

  it('healthCheck returns ok + model list; listModels lists ids', async () => {
    const { fetch } = makeFetch(() => ({ body: { data: [{ id: 'qwen36-27b-mtp' }, { id: 'lift' }] } }));
    const gw = createLlmGateway(cfg, { fetch });
    expect(await gw.healthCheck()).toMatchObject({ status: 'ok', models: ['qwen36-27b-mtp', 'lift'] });
    expect(await gw.listModels()).toEqual([{ id: 'qwen36-27b-mtp' }, { id: 'lift' }]);
  });

  it('healthCheck returns down on upstream failure (no throw)', async () => {
    const { fetch } = makeFetch(() => ({ status: 503 }));
    expect(await createLlmGateway(cfg, { fetch }).healthCheck()).toMatchObject({ status: 'down' });
  });
});
