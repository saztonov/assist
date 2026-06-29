// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { useWorkflowEditor } from './useWorkflowEditor';
import { BASE_BLOCKS } from './catalog';

interface Call {
  url: string;
  method: string;
}

let calls: Call[];

function detail(status: 'draft' | 'published'): unknown {
  return {
    id: 'tpl-1',
    key: 'tpl-1',
    name: 'Новый шаблон',
    description: null,
    status,
    latestVersion: 1,
    createdBy: 'u',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    definition: {
      id: 'tpl-1',
      name: 'Новый шаблон',
      version: 1,
      nodes: [{ id: 'a', type: 'manual_trigger', position: { x: 0, y: 0 } }],
      edges: [],
    },
  };
}

function stubFetch(): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      let body: unknown = detail('draft');
      if (url.includes('/publish')) body = detail('published');
      else if (url.includes('/test-run')) body = { id: 'task-1', status: 'queued' };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => '',
      } as Response;
    }),
  );
}

const trigger = BASE_BLOCKS.find((b) => b.key === 'manual_trigger')!;

beforeEach(() => stubFetch());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useWorkflowEditor API wiring', () => {
  it('New → POST; повторное сохранение → PUT /draft', async () => {
    const { result } = renderHook(() => useWorkflowEditor(null));
    act(() => result.current.addNode(trigger));
    await act(async () => {
      await result.current.saveDraft();
    });
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/workflow-templates'))).toBe(true);
    await waitFor(() => expect(result.current.templateId).toBe('tpl-1'));

    await act(async () => {
      await result.current.saveDraft();
    });
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/workflow-templates/tpl-1/draft'))).toBe(
      true,
    );
  });

  it('publish → POST /publish; test-run → POST /test-run', async () => {
    const { result } = renderHook(() => useWorkflowEditor(null));
    act(() => result.current.addNode(trigger));
    await act(async () => {
      await result.current.publish();
    });
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/publish'))).toBe(true);

    let taskId: string | null = null;
    await act(async () => {
      taskId = await result.current.testRun();
    });
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/test-run'))).toBe(true);
    expect(taskId).toBe('task-1');
  });

  it('все сетевые вызовы идут на /api/v1', async () => {
    const { result } = renderHook(() => useWorkflowEditor(null));
    act(() => result.current.addNode(trigger));
    await act(async () => {
      await result.current.testRun();
    });
    for (const c of calls) {
      expect(c.url).toContain('/api/v1/');
    }
  });
});
