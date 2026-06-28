/**
 * Детерминированный fake `LlmGateway` для тестов и local-first прогона до этапа 8.
 * Реальный OpenAI-совместимый клиент LM Studio реализуется в `@su10/llm` (этап 8).
 * НЕ делает сетевых вызовов.
 */
import type { ChatRequest, EmbedRequest, LlmGateway } from '@su10/llm';

export interface FakeLlmOptions {
  /** Кастомный ответ chat по сообщениям; по умолчанию — эхо последнего user. */
  chat?: (req: ChatRequest) => string;
  /** Размерность фейковых эмбеддингов. */
  embedDim?: number;
}

export function createFakeLlmGateway(opts: FakeLlmOptions = {}): LlmGateway {
  const dim = opts.embedDim ?? 8;
  return {
    async chat(req) {
      const last = req.messages.at(-1)?.content ?? '';
      return { content: opts.chat ? opts.chat(req) : `echo: ${last}` };
    },
    async embed(req: EmbedRequest) {
      return { vectors: req.input.map(() => Array.from({ length: dim }, () => 0)) };
    },
  };
}
