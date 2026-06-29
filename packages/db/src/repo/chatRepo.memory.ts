/**
 * In-memory реализация `ChatRepo` для DB-free unit/integration тестов
 * (agent-api `app.inject`). Самостоятельная корректная реализация интерфейса,
 * не фейк Drizzle. Семантика: сессии скоупятся по `userId` (admin видит все),
 * сообщения упорядочены по времени создания.
 */
import { randomUUID } from 'node:crypto';
import type {
  AddMessageInput,
  ChatMessageRow,
  ChatRepo,
  ChatSessionRow,
  CreateSessionInput,
  ListSessionsFilter,
} from './chatRepo.js';

export class InMemoryChatRepo implements ChatRepo {
  readonly sessions: ChatSessionRow[] = [];
  readonly messages: ChatMessageRow[] = [];
  private seq = 0;

  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1) + this.seq++ * 1000);
  }

  async createSession(input: CreateSessionInput): Promise<ChatSessionRow> {
    const ts = this.now();
    const row: ChatSessionRow = {
      id: randomUUID(),
      userId: input.userId,
      sourcePortal: input.sourcePortal ?? null,
      title: input.title ?? null,
      status: 'active',
      metadataJson: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.sessions.push(row);
    return row;
  }

  async listSessions(filter: ListSessionsFilter): Promise<ChatSessionRow[]> {
    let rows = [...this.sessions];
    if (!filter.isAdmin) rows = rows.filter((s) => s.userId === filter.requesterId);
    rows.sort((a, b) => {
      const d = b.updatedAt.getTime() - a.updatedAt.getTime();
      return d !== 0 ? d : b.id.localeCompare(a.id);
    });
    return rows.slice(0, filter.limit);
  }

  async getSession(id: string): Promise<ChatSessionRow | undefined> {
    return this.sessions.find((s) => s.id === id);
  }

  async listMessages(sessionId: string): Promise<ChatMessageRow[]> {
    return this.messages
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => {
        const d = a.createdAt.getTime() - b.createdAt.getTime();
        return d !== 0 ? d : a.id.localeCompare(b.id);
      });
  }

  async addMessage(input: AddMessageInput): Promise<ChatMessageRow> {
    const row: ChatMessageRow = {
      id: randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      toolCallJson: input.toolCallJson ?? null,
      tokenCount: input.tokenCount ?? null,
      createdAt: this.now(),
    };
    this.messages.push(row);
    const session = this.sessions.find((s) => s.id === input.sessionId);
    if (session) session.updatedAt = this.now();
    return row;
  }
}
