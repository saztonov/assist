import { describe, it, expect } from 'vitest';
import { createAgentApiClient } from './api-client.js';

describe('portal-agent-widgets api client', () => {
  it('calls only the backend API using the injected base + fetch', async () => {
    let called = '';
    const fakeFetch = (async (url: string) => {
      called = String(url);
      return { json: async () => ({ id: '42' }) };
    }) as unknown as typeof fetch;

    const client = createAgentApiClient('/api-base', fakeFetch);
    await client.getTask('42');
    expect(called).toBe('/api-base/api/v1/agent/tasks/42');
  });
});
