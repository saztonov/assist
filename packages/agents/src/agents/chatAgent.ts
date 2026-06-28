/** chat_agent — диалог через LLM Gateway (LangGraph StateGraph, один узел). */
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { callLlmStep, type AgentDefinition } from '../runtime.js';

export function chatAgent(): AgentDefinition {
  return {
    name: 'chat_agent',
    allowedTools: [],
    build(ctx) {
      const State = Annotation.Root({
        prompt: Annotation<string>(),
        output: Annotation<string>(),
      });
      const graph = new StateGraph(State)
        .addNode('chat', async (s) => {
          const content = await callLlmStep(ctx, {
            messages: [{ role: 'user', content: s.prompt }],
          });
          return { output: content };
        })
        .addEdge(START, 'chat')
        .addEdge('chat', END)
        .compile();

      return {
        async invoke(input) {
          const out = await graph.invoke({ prompt: input.prompt });
          return { output: out.output };
        },
      };
    },
  };
}
