import { describe, it, expect } from 'vitest';
import type { AuditEvent } from '@su10/audit';
import { mapAuditEventToRow } from './dbAuditSink.js';

const baseEvent: AuditEvent = {
  actor: 'u-1',
  action: 'agent_task.create',
  resource: 'agent_task:t-1',
  outcome: 'success',
  at: '2026-06-28T10:00:00.000Z',
  meta: { taskId: 't-1', status: 'created' },
};

describe('mapAuditEventToRow', () => {
  it('маппит событие + контекст в строку audit_events', () => {
    const row = mapAuditEventToRow(baseEvent, {
      correlationId: 'corr-1',
      sourcePortal: 'portal-a',
    });
    expect(row).toMatchObject({
      actor: 'u-1',
      action: 'agent_task.create',
      resource: 'agent_task:t-1',
      outcome: 'success',
      correlationId: 'corr-1',
      sourcePortal: 'portal-a',
      metaJson: { taskId: 't-1', status: 'created' },
    });
    expect(row.at).toBeInstanceOf(Date);
    expect((row.at as Date).toISOString()).toBe('2026-06-28T10:00:00.000Z');
  });

  it('без контекста correlationId/sourcePortal = null', () => {
    const row = mapAuditEventToRow(baseEvent);
    expect(row.correlationId).toBeNull();
    expect(row.sourcePortal).toBeNull();
  });

  it('не содержит сырых секретов/тел (только курируемый meta)', () => {
    const row = mapAuditEventToRow({ ...baseEvent, resource: undefined, meta: undefined });
    expect(row.resource).toBeNull();
    expect(row.metaJson).toBeNull();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/authorization|bearer|secret|password|token/i);
  });
});
