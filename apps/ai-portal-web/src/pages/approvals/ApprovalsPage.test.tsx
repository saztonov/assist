// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ApprovalsPage } from './ApprovalsPage';

function jsonRes(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

const pending = {
  id: 'a-1',
  taskId: null,
  toolCallId: null,
  subjectId: 'u',
  riskLevel: 'high',
  action: 'mail.create_draft',
  resource: 'draft:1',
  status: 'pending',
  decidedBy: null,
  decidedAt: null,
  reason: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('ApprovalsPage', () => {
  let approveCalled = false;
  beforeEach(() => {
    approveCalled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url.includes('/approvals/a-1/approve') && method === 'POST') {
          approveCalled = true;
          return jsonRes({ ...pending, status: 'approved' });
        }
        if (url.includes('/approvals') && method === 'GET') {
          // После approve список pending пуст.
          return jsonRes({ items: approveCalled ? [] : [pending] });
        }
        return jsonRes({});
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('approve вызывает endpoint и обновляет список', async () => {
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText('mail.create_draft')).toBeTruthy());

    fireEvent.click(screen.getByText('Approve'));
    // Подтверждение в Popconfirm.
    await waitFor(() => expect(screen.getByText('OK')).toBeTruthy());
    fireEvent.click(screen.getByText('OK'));

    await waitFor(() => expect(approveCalled).toBe(true));
    await waitFor(() => expect(screen.getByText('Нет ожидающих подтверждений')).toBeTruthy());
  });
});
