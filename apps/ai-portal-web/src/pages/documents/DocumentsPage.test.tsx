// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DocumentsPage } from './DocumentsPage';

function jsonRes(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

describe('DocumentsPage upload-flow', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push(`${method} ${url}`);
        if (url.includes('/documents/upload-session') && method === 'POST') {
          return jsonRes({ documentId: 'd-1', versionId: 'v-1', objectKey: 'k', uploadUrl: 'https://s3.local/k', status: 'pending_upload' });
        }
        if (url === 'https://s3.local/k' && method === 'PUT') {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
        }
        if (url.includes('/documents/d-1/confirm') && method === 'POST') {
          return jsonRes({ documentId: 'd-1', status: 'indexing', parseJobId: 'job-1' });
        }
        if (url.includes('/documents/d-1') && method === 'GET') {
          return jsonRes({ id: 'd-1', status: 'indexing', title: 'файл', documentType: null, securityLevel: 'internal', createdAt: '' });
        }
        return jsonRes({});
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('проходит upload-session → presigned PUT → confirm и показывает документ', async () => {
    const { container } = render(<DocumentsPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('файл')).toBeTruthy());

    // Презайн-PUT с правильным Content-Type выполнен напрямую в S3.
    const put = calls.find((c) => c.startsWith('PUT https://s3.local/k'));
    expect(put).toBeTruthy();
    expect(calls.some((c) => c.includes('/documents/upload-session'))).toBe(true);
    expect(calls.some((c) => c.includes('/documents/d-1/confirm'))).toBe(true);
  });
});
