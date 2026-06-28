/**
 * `rag.search` tool — RAG retrieval for agents via the Tool Registry/Broker.
 * NODE-ONLY.
 *
 * Shares the SAME `ragService` as the `/rag/search` HTTP route → a single
 * ACL-before-retrieval path. The broker enforces roles/audit; the handler builds
 * the ExecutionContext from the calling subject (permission already granted).
 */
import { z } from 'zod';
import type { ToolDefinition } from '@su10/tools';
import { RagScopeSchema, type ExecutionContext } from './aclPredicate.js';
import type { RagService } from './ragService.js';

export const RagSearchInput = z.object({
  query: z.string().min(1),
  k: z.number().int().positive().max(50).optional(),
  scope: RagScopeSchema.optional(),
});

export const RagSearchOutput = z.object({
  chunks: z.array(
    z.object({
      chunkId: z.string(),
      documentId: z.string(),
      content: z.string(),
      score: z.number(),
    }),
  ),
  citations: z.array(
    z.object({
      documentId: z.string(),
      chunkId: z.string(),
      pageFrom: z.number().nullable().optional(),
      pageTo: z.number().nullable().optional(),
      title: z.string().nullable().optional(),
    }),
  ),
});

export interface RagToolDeps {
  ragService: RagService;
}

export function ragSearchTool(
  deps: RagToolDeps,
): ToolDefinition<z.infer<typeof RagSearchInput>, z.infer<typeof RagSearchOutput>> {
  return {
    name: 'rag.search',
    version: 1,
    description: 'ACL-safe retrieval over the document corpus (vector + lexical + RRF).',
    category: 'system',
    riskLevel: 'low',
    inputSchema: RagSearchInput,
    outputSchema: RagSearchOutput,
    allowedRoles: ['rag.read', 'agent.run'],
    timeoutMs: 30_000,
    async handler(input, ctx) {
      const context: ExecutionContext = {
        subject: ctx.subject,
        permission: { allowed: true },
        allowedDepartments: [],
        allowedProjects: [],
        ...(input.scope ? { scope: input.scope } : {}),
      };
      const res = await deps.ragService.search({
        query: input.query,
        context,
        ...(input.k !== undefined ? { k: input.k } : {}),
      });
      return {
        chunks: res.chunks.map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          content: c.content,
          score: c.score,
        })),
        citations: res.citations.map((c) => ({
          documentId: c.documentId,
          chunkId: c.chunkId,
          pageFrom: c.pageFrom ?? null,
          pageTo: c.pageTo ?? null,
          title: c.title ?? null,
        })),
      };
    },
  };
}
