/**
 * REST чата (этап 12). Регистрируется ВНУТРИ authed-scope, поэтому `req.auth`
 * гарантирован. Доступ — владелец + admin (чужая/несуществующая сессия → 404).
 *
 * Ответ ассистента — детерминированный mock (echo). Реальный LLM/LangGraph —
 * отдельный этап; здесь модель НЕ вызывается. Контент сообщений НЕ логируется и
 * НЕ попадает в audit (только метаданные: ids, длина, роль).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { NotFoundError } from '@su10/errors';
import type { ChatRepo } from '@su10/db';
import { CHAT_ACTIONS } from '../audit/auditActions.js';
import { canUseSession, isAdmin } from './access.js';
import {
  CreateSessionBody,
  ListSessionsQuery,
  ListSessionsResponse,
  PostMessageBody,
  PostMessageResponse,
  SessionCardSchema,
  SessionIdParams,
  SessionWithMessagesResponse,
  toChatMessage,
  toSessionCard,
} from './dto.js';

export interface AgentChatDeps {
  chatRepo: ChatRepo;
  auditSink: AuditSink;
}

function authOf(req: FastifyRequest): { sub: string; roles: string[] } {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('session not found');
  return { sub: auth.sub, roles: auth.roles };
}

const nowIso = (): string => new Date().toISOString();

/** Детерминированный mock-агент. НЕ вызывает LLM; ответ всегда воспроизводим. */
function mockAssistantReply(userContent: string): string {
  return `Эхо: ${userContent}`;
}

export const agentChatRoutes: FastifyPluginAsync<AgentChatDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { chatRepo, auditSink } = deps;

  // POST /agent/chat/sessions — создать сессию.
  app.post(
    '/agent/chat/sessions',
    {
      schema: {
        tags: ['agent-chat'],
        summary: 'Создать чат-сессию',
        body: CreateSessionBody,
        response: { 201: SessionCardSchema },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const session = await chatRepo.createSession({
        userId: auth.sub,
        sourcePortal: req.ctx.sourcePortal ?? null,
        title: req.body.title ?? null,
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: CHAT_ACTIONS.sessionCreate,
        resource: `chat_session:${session.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { sessionId: session.id },
      });
      return reply.code(201).send(toSessionCard(session));
    },
  );

  // GET /agent/chat/sessions — список сессий (владелец + admin).
  app.get(
    '/agent/chat/sessions',
    {
      schema: {
        tags: ['agent-chat'],
        summary: 'Список чат-сессий',
        querystring: ListSessionsQuery,
        response: { 200: ListSessionsResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const sessions = await chatRepo.listSessions({
        requesterId: auth.sub,
        isAdmin: isAdmin(auth.roles),
        limit: req.query.limit,
      });
      return { items: sessions.map(toSessionCard) };
    },
  );

  // GET /agent/chat/sessions/:id — сессия + сообщения.
  app.get(
    '/agent/chat/sessions/:id',
    {
      schema: {
        tags: ['agent-chat'],
        summary: 'Сессия и её сообщения',
        params: SessionIdParams,
        response: { 200: SessionWithMessagesResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const session = await chatRepo.getSession(req.params.id);
      if (!session || !canUseSession(auth, session)) throw new NotFoundError('session not found');
      const messages = await chatRepo.listMessages(session.id);
      return { session: toSessionCard(session), messages: messages.map(toChatMessage) };
    },
  );

  // POST /agent/chat/sessions/:id/messages — сообщение пользователя + ответ mock-агента.
  app.post(
    '/agent/chat/sessions/:id/messages',
    {
      schema: {
        tags: ['agent-chat'],
        summary: 'Отправить сообщение и получить ответ агента (mock)',
        params: SessionIdParams,
        body: PostMessageBody,
        response: { 201: PostMessageResponse },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const session = await chatRepo.getSession(req.params.id);
      if (!session || !canUseSession(auth, session)) throw new NotFoundError('session not found');

      const userMessage = await chatRepo.addMessage({
        sessionId: session.id,
        role: 'user',
        content: req.body.content,
      });
      const assistantMessage = await chatRepo.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: mockAssistantReply(req.body.content),
      });

      // Audit без контента: только метаданные (длина, ids).
      await audit(auditSink, {
        actor: auth.sub,
        action: CHAT_ACTIONS.messagePost,
        resource: `chat_session:${session.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: {
          sessionId: session.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          contentLength: req.body.content.length,
        },
      });

      return reply
        .code(201)
        .send({ userMessage: toChatMessage(userMessage), assistantMessage: toChatMessage(assistantMessage) });
    },
  );
};
