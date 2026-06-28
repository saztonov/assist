/**
 * RAG API (этап 9 / M4). Registered INSIDE the authed-scope (`req.auth`).
 *
 * `/rag/search` and the `rag.search` tool share the SAME `ragService` → one
 * ACL-before-retrieval path. `/rag/answer` passes ONLY allowed snippets to the
 * LLM gateway and returns citations; on gateway failure it returns a typed
 * upstream error. Raw chunks/documents are never logged.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { AuthzError, NotFoundError, UpstreamError } from '@su10/errors';
import type { ExecutionContext, RagScope, RagService } from '@su10/rag';
import type { LlmGatewayService } from '@su10/llm';
import { RAG_ACTIONS } from '../audit/auditActions.js';
import { RagAnswerResponse, RagSearchBody, RagSearchResponse, RagStatusResponse } from './dto.js';

export interface RagDeps {
  ragService: RagService;
  llm: Pick<LlmGatewayService, 'analyzeLongContext'>;
  auditSink: AuditSink;
}

function authOf(req: FastifyRequest): { sub: string; roles: string[] } {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('not found');
  return { sub: auth.sub, roles: auth.roles };
}

/** Authenticated subject → ExecutionContext. Visibility is enforced by the ACL
 *  predicate; department/project entitlements default to none (fail-closed). */
function contextOf(
  auth: { sub: string; roles: string[] },
  scope?: RagScope,
): ExecutionContext {
  return {
    subject: { id: auth.sub, roles: auth.roles },
    permission: { allowed: true },
    allowedDepartments: [],
    allowedProjects: [],
    ...(scope ? { scope } : {}),
  };
}

const nowIso = (): string => new Date().toISOString();

export const ragRoutes: FastifyPluginAsync<RagDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { ragService, llm, auditSink } = deps;

  // POST /rag/search — ACL-safe retrieval with citations + timings.
  app.post(
    '/rag/search',
    {
      schema: {
        tags: ['rag'],
        summary: 'ACL-safe RAG поиск (vector + lexical + RRF)',
        body: RagSearchBody,
        response: { 200: RagSearchResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const body = req.body;
      const result = await ragService.search({
        query: body.query,
        context: contextOf(auth, body.scope),
        ...(body.k !== undefined ? { k: body.k } : {}),
        ...(body.profile ? { profile: body.profile } : {}),
      });
      return result;
    },
  );

  // POST /rag/answer — answer strictly from allowed snippets, with citations.
  app.post(
    '/rag/answer',
    {
      schema: {
        tags: ['rag'],
        summary: 'RAG ответ по разрешённому контексту (с цитатами)',
        body: RagSearchBody,
        response: { 200: RagAnswerResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const body = req.body;
      const result = await ragService.search({
        query: body.query,
        context: contextOf(auth, body.scope),
        ...(body.k !== undefined ? { k: body.k } : {}),
        ...(body.profile ? { profile: body.profile } : {}),
      });

      const contextText = result.chunks
        .map((c, i) => `[${i + 1}] ${c.content}`)
        .join('\n\n');

      let answer: string;
      try {
        answer = await llm.analyzeLongContext({
          text: contextText || '(контекст пуст)',
          task:
            'Ответь на вопрос пользователя СТРОГО на основе предоставленного контекста. ' +
            'Если в контексте нет ответа — так и скажи. Ссылайся на номера фрагментов [N]. ' +
            `Вопрос: ${body.query}`,
          noThink: false,
        });
      } catch (err) {
        req.log.error({ err }, 'rag answer: llm gateway failed');
        throw new UpstreamError('LLM gateway unavailable for RAG answer');
      }

      await audit(auditSink, {
        actor: auth.sub,
        action: RAG_ACTIONS.answer,
        resource: 'rag',
        outcome: 'success',
        at: nowIso(),
        meta: { resultCount: result.chunks.length, backend: result.backend },
      });
      return { answer, citations: result.citations, backend: result.backend };
    },
  );

  // GET /rag/status — admin-only diagnostics (metadata only).
  app.get(
    '/rag/status',
    {
      schema: {
        tags: ['rag'],
        summary: 'RAG статус (admin)',
        response: { 200: RagStatusResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      if (!auth.roles.includes('admin')) throw new AuthzError('admin role required');
      return { backend: 'pgvector', aclEnforced: true };
    },
  );
};
