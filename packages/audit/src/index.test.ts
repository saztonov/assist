import { describe, it, expect } from 'vitest';
import { InMemoryAuditSink, audit } from './index.js';

describe('audit', () => {
  it('validates and records an event', async () => {
    const sink = new InMemoryAuditSink();
    await audit(sink, { actor: 'u1', action: 'tool.invoke', outcome: 'success', at: '2026-01-01T00:00:00Z' });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.action).toBe('tool.invoke');
  });

  it('rejects an event with an invalid outcome', async () => {
    const sink = new InMemoryAuditSink();
    await expect(
      audit(sink, { actor: 'u', action: 'a', outcome: 'boom' as never, at: 't' }),
    ).rejects.toThrow();
  });
});
