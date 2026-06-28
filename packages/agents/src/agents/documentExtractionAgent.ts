/**
 * document_extraction_agent — строгое извлечение JSON по zod-схеме (паттерн `lift`).
 * Возвращает zod-валидированный объект в `data`; невалидный JSON → ValidationError.
 */
import type { ZodTypeAny } from 'zod';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { ValidationError } from '@su10/errors';
import { callLlmStep, type AgentDefinition } from '../runtime.js';

const EXTRACT_SYSTEM =
  'Извлеки данные строго по JSON-схеме. Верни ТОЛЬКО валидный JSON без пояснений и Markdown. ' +
  'Если значение не найдено — null; если список не найден — [].';

export function documentExtractionAgent(): AgentDefinition {
  return {
    name: 'document_extraction_agent',
    allowedTools: [],
    build(ctx) {
      const State = Annotation.Root({
        prompt: Annotation<string>(),
        schema: Annotation<ZodTypeAny | undefined>(),
        output: Annotation<string>(),
        data: Annotation<unknown>(),
      });
      const graph = new StateGraph(State)
        .addNode('extract', async (s) => {
          const content = await callLlmStep(ctx, {
            messages: [
              { role: 'system', content: EXTRACT_SYSTEM },
              { role: 'user', content: s.prompt },
            ],
          });
          let parsed: unknown;
          try {
            parsed = JSON.parse(content);
          } catch {
            throw new ValidationError('extraction did not return valid JSON');
          }
          const data = s.schema ? s.schema.parse(parsed) : parsed;
          return { output: content, data };
        })
        .addEdge(START, 'extract')
        .addEdge('extract', END)
        .compile();

      return {
        async invoke(input) {
          const out = await graph.invoke({ prompt: input.prompt, schema: input.schema });
          return { output: out.output, data: out.data };
        },
      };
    },
  };
}
