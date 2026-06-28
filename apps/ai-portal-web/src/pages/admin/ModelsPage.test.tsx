// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ModelsPage } from './ModelsPage';

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body =
        url.includes('/llm/models') && !url.includes('/test')
          ? { models: [{ modelId: 'qwen36-27b-mtp', purpose: 'analysis', contextWindow: 131072, maxParallelRequests: 1, registered: true, available: true }] }
          : url.includes('/llm/providers')
            ? { providers: [] }
            : url.includes('/llm/policies')
              ? { policies: [] }
              : {};
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    }),
  );
}

describe('ModelsPage', () => {
  beforeEach(() => {
    mockFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the models admin heading and loads models', async () => {
    render(<ModelsPage />);
    expect(screen.getByText('Модели LLM')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('qwen36-27b-mtp')).toBeTruthy());
  });

  it('calls only the backend /api/v1 surface', async () => {
    render(<ModelsPage />);
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThan(0));
    const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    for (const u of urls) expect(u.startsWith('/api/v1/')).toBe(true);
  });
});
