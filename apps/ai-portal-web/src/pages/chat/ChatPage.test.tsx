// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ChatPage } from './ChatPage';

function jsonRes(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

describe('ChatPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url.endsWith('/agent/chat/sessions') && method === 'GET') {
          return jsonRes({ items: [{ id: 's-1', userId: 'u', title: 'Сессия', status: 'active', sourcePortal: null, createdAt: '', updatedAt: '' }] });
        }
        if (url.includes('/agent/chat/sessions/s-1/messages') && method === 'POST') {
          return jsonRes({
            userMessage: { id: 'm1', sessionId: 's-1', role: 'user', content: 'привет', createdAt: '' },
            assistantMessage: { id: 'm2', sessionId: 's-1', role: 'assistant', content: 'Эхо: привет', createdAt: '' },
          });
        }
        if (url.includes('/agent/chat/sessions/s-1') && method === 'GET') {
          return jsonRes({ session: { id: 's-1', userId: 'u', title: 'Сессия', status: 'active', sourcePortal: null, createdAt: '', updatedAt: '' }, messages: [] });
        }
        return jsonRes({});
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('отправка сообщения показывает ответ mock-агента', async () => {
    render(<ChatPage />);
    // Открыть сессию из списка.
    await waitFor(() => expect(screen.getByText('Сессия')).toBeTruthy());
    fireEvent.click(screen.getByText('Сессия'));

    await waitFor(() => expect(screen.getByPlaceholderText('Сообщение агенту...')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Сообщение агенту...'), { target: { value: 'привет' } });
    fireEvent.click(screen.getByText('Отправить'));

    await waitFor(() => expect(screen.getByText('Эхо: привет')).toBeTruthy());
    expect(screen.getByText('привет')).toBeTruthy();
  });
});
