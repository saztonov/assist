import { describe, it, expect } from 'vitest';
import { UpstreamError } from '@su10/errors';
import { createStubTemporalPort } from './stubTemporalPort.js';

describe('stubTemporalPort', () => {
  it('start возвращает детерминированный workflowId и фиксирует его', async () => {
    const p = createStubTemporalPort();
    const r = await p.startAgentTaskWorkflow({ taskId: 't-1', taskQueue: 'q' });
    expect(r.workflowId).toBe('agent-task-t-1');
    expect(p.started.has('agent-task-t-1')).toBe(true);
  });

  it('failStart → UpstreamError', async () => {
    const p = createStubTemporalPort({ failStart: true });
    await expect(p.startAgentTaskWorkflow({ taskId: 't', taskQueue: 'q' })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  it('signalCancel фиксирует отмену', async () => {
    const p = createStubTemporalPort();
    await p.signalCancel('wf-1');
    expect(p.cancelled.has('wf-1')).toBe(true);
  });

  it('failCancel → UpstreamError', async () => {
    const p = createStubTemporalPort({ failCancel: true });
    await expect(p.signalCancel('wf')).rejects.toBeInstanceOf(UpstreamError);
  });
});
