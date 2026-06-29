/** zod-контракты REST чата + мапперы строк БД в DTO (ISO-даты). Контент сообщений
 * передаётся в ответах, но НЕ логируется и НЕ попадает в audit. */
import { z } from 'zod';
import type { ChatSessionRow, ChatMessageRow } from '@su10/db';

// ---- requests ----
export const CreateSessionBody = z.object({
  title: z.string().min(1).max(200).optional(),
});

export const SessionIdParams = z.object({ id: z.string().uuid() });

export const PostMessageBody = z.object({
  content: z.string().min(1).max(8000),
});

export const ListSessionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ---- responses ----
export const SessionCardSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  sourcePortal: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ListSessionsResponse = z.object({ items: z.array(SessionCardSchema) });

export const ChatMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export const SessionWithMessagesResponse = z.object({
  session: SessionCardSchema,
  messages: z.array(ChatMessageSchema),
});

export const PostMessageResponse = z.object({
  userMessage: ChatMessageSchema,
  assistantMessage: ChatMessageSchema,
});

export type SessionCard = z.infer<typeof SessionCardSchema>;
export type ChatMessageDto = z.infer<typeof ChatMessageSchema>;

// ---- mappers (row → DTO) ----
export function toSessionCard(row: ChatSessionRow): SessionCard {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status,
    sourcePortal: row.sourcePortal,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toChatMessage(row: ChatMessageRow): ChatMessageDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}
