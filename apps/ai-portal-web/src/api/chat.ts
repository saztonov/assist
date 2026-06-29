/** Типизированный доступ к /agent/chat (mock-агент). */
import { api } from './client';

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  status: string;
  sourcePortal: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

export const chatApi = {
  listSessions: (): Promise<{ items: ChatSession[] }> =>
    api.get<{ items: ChatSession[] }>('/agent/chat/sessions'),
  createSession: (title?: string): Promise<ChatSession> =>
    api.post<ChatSession>('/agent/chat/sessions', title ? { title } : {}),
  getSession: (id: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> =>
    api.get<{ session: ChatSession; messages: ChatMessage[] }>(`/agent/chat/sessions/${id}`),
  postMessage: (
    id: string,
    content: string,
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> =>
    api.post<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(
      `/agent/chat/sessions/${id}/messages`,
      { content },
    ),
};
