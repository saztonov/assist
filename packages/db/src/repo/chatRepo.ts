/**
 * Репозиторий чат-сессий и сообщений. Весь доступ к PostgreSQL — здесь. NODE-ONLY.
 *
 * Источник истины диалога — таблицы `chat_sessions` / `chat_messages`. Scope доступа
 * (владелец/admin) применяется на слое API; здесь `listSessions` фильтрует по
 * `requesterId` для не-admin. Контент сообщений в логи/audit не попадает.
 */
import { desc, eq } from 'drizzle-orm';
import { chatSessions, chatMessages } from '../schema/chat.js';
import type { Database } from '../index.js';

export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;

export interface CreateSessionInput {
  userId: string;
  sourcePortal?: string | null;
  title?: string | null;
}

export interface ListSessionsFilter {
  requesterId: string;
  isAdmin: boolean;
  limit: number;
}

export interface AddMessageInput {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCallJson?: unknown;
  tokenCount?: number | null;
}

export interface ChatRepo {
  createSession(input: CreateSessionInput): Promise<ChatSessionRow>;
  listSessions(filter: ListSessionsFilter): Promise<ChatSessionRow[]>;
  getSession(id: string): Promise<ChatSessionRow | undefined>;
  listMessages(sessionId: string): Promise<ChatMessageRow[]>;
  addMessage(input: AddMessageInput): Promise<ChatMessageRow>;
}

export function createChatRepo(db: Database): ChatRepo {
  return {
    async createSession(input) {
      const [row] = await db
        .insert(chatSessions)
        .values({
          userId: input.userId,
          sourcePortal: input.sourcePortal ?? null,
          title: input.title ?? null,
          status: 'active',
        })
        .returning();
      return row;
    },

    async listSessions(filter) {
      const where = filter.isAdmin ? undefined : eq(chatSessions.userId, filter.requesterId);
      const q = db
        .select()
        .from(chatSessions)
        .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.id))
        .limit(filter.limit);
      return where ? q.where(where) : q;
    },

    async getSession(id) {
      const [row] = await db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
      return row;
    },

    async listMessages(sessionId) {
      return db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, sessionId))
        .orderBy(chatMessages.createdAt, chatMessages.id);
    },

    async addMessage(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(chatMessages)
          .values({
            sessionId: input.sessionId,
            role: input.role,
            content: input.content,
            toolCallJson: input.toolCallJson ?? null,
            tokenCount: input.tokenCount ?? null,
          })
          .returning();
        // Поднимаем updatedAt сессии, чтобы listSessions сортировался по активности.
        await tx
          .update(chatSessions)
          .set({ updatedAt: new Date() })
          .where(eq(chatSessions.id, input.sessionId));
        return row;
      });
    },
  };
}
