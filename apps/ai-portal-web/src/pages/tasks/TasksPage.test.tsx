// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { TasksPage } from './TasksPage';

function jsonRes(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

describe('TasksPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/agent/tasks')) {
          return jsonRes({
            items: [
              { id: 't-1', status: 'queued', title: 'Обработать счёт', taskType: 'document', workflowId: null, createdBy: 'u', errorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            ],
          });
        }
        return jsonRes({});
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('отображает список задач', async () => {
    render(<TasksPage />);
    await waitFor(() => expect(screen.getByText('Обработать счёт')).toBeTruthy());
    expect(screen.getByText('queued')).toBeTruthy();
  });
});
