/**
 * rag_agent — retrieval-augmented ответ. Шаг retrieve вызывает инструмент
 * `rag.search` ЧЕРЕЗ ToolBroker (ACL/permission — внутри инструмента, этап 9);
 * шаг answer формирует ответ только по полученному контексту.
 */
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { hashJson } from '@su10/tools';
import { callLlmStep, invokeAgentTool, type AgentDefinition } from '../runtime.js';

const RAG_SEARCH_TOOL = 'rag.search';

export function ragAgent(): AgentDefinition {
  return {
    name: 'rag_agent',
    allowedTools: [RAG_SEARCH_TOOL],
    build(ctx) {
      const State = Annotation.Root({
        prompt: Annotation<string>(),
        context: Annotation<string>(),
        output: Annotation<string>(),
      });
      const graph = new StateGraph(State)
        .addNode('retrieve', async (s) => {
          const started = Date.now();
          const res = await invokeAgentTool(ctx, RAG_SEARCH_TOOL, { query: s.prompt });
          await ctx.recordStep({
            stepType: 'tool',
            toolName: RAG_SEARCH_TOOL,
            status: 'success',
            durationMs: Date.now() - started,
            outputHash: hashJson(res),
          });
          return { context: JSON.stringify(res) };
        })
        .addNode('answer', async (s) => {
          const content = await callLlmStep(ctx, {
            messages: [
              {
                role: 'system',
                content:
                  'Отвечай строго по предоставленному контексту. Если ответа в контексте нет — так и скажи.',
              },
              { role: 'user', content: `Контекст:\n${s.context}\n\nВопрос: ${s.prompt}` },
            ],
          });
          return { output: content };
        })
        .addEdge(START, 'retrieve')
        .addEdge('retrieve', 'answer')
        .addEdge('answer', END)
        .compile();

      return {
        async invoke(input) {
          const out = await graph.invoke({ prompt: input.prompt });
          return { output: out.output, data: { context: out.context } };
        },
      };
    },
  };
}
