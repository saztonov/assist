/** Zod DTOs for the RAG API. */
import { z } from 'zod';
import { RagScopeSchema } from '@su10/rag';

export const RagSearchBody = z.object({
  query: z.string().min(1).max(4000),
  k: z.number().int().positive().max(50).optional(),
  scope: RagScopeSchema.optional(),
  profile: z.string().max(100).optional(),
});

export const CitationSchema = z.object({
  documentId: z.string(),
  chunkId: z.string(),
  pageFrom: z.number().nullable().optional(),
  pageTo: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
});

export const TimingsSchema = z.object({
  embeddingMs: z.number(),
  vectorMs: z.number(),
  lexicalMs: z.number(),
  fusionMs: z.number(),
  hydrationMs: z.number(),
  rerankMs: z.number(),
  totalMs: z.number(),
});

export const RagSearchResponse = z.object({
  chunks: z.array(
    z.object({
      chunkId: z.string(),
      documentId: z.string(),
      content: z.string(),
      score: z.number(),
      citation: CitationSchema,
    }),
  ),
  citations: z.array(CitationSchema),
  timings: TimingsSchema,
  backend: z.string(),
});

export const RagAnswerResponse = z.object({
  answer: z.string(),
  citations: z.array(CitationSchema),
  backend: z.string(),
});

export const RagStatusResponse = z.object({
  backend: z.string(),
  aclEnforced: z.boolean(),
});
