import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';

describe('agent-api', () => {
  it('GET /health returns ok', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('rejects an invalid workflow template with 400', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/templates',
      payload: { nope: true },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
