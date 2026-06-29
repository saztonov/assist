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

  it('start с template фиксируется как visual; без template — нет', async () => {
    const p = createStubTemporalPort();
    const visual = await p.startAgentTaskWorkflow({
      taskId: 'v-1',
      taskQueue: 'q',
      template: { id: 'd', name: 'n', version: 1, nodes: [], edges: [] },
    });
    const generic = await p.startAgentTaskWorkflow({ taskId: 'g-1', taskQueue: 'q' });
    expect(p.startedVisual.has(visual.workflowId)).toBe(true);
    expect(p.startedVisual.has(generic.workflowId)).toBe(false);
    expect(p.started.has(visual.workflowId)).toBe(true);
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

  it('startDocumentProcessingWorkflow возвращает детерминированный workflowId', async () => {
    const p = createStubTemporalPort();
    const r = await p.startDocumentProcessingWorkflow({
      documentId: 'doc-1',
      documentVersionId: 'ver-1',
      taskQueue: 'q',
    });
    expect(r.workflowId).toBe('document-doc-1');
    expect(p.started.has('document-doc-1')).toBe(true);
  });

  it('failDocStart → UpstreamError', async () => {
    const p = createStubTemporalPort({ failDocStart: true });
    await expect(
      p.startDocumentProcessingWorkflow({ documentId: 'd', documentVersionId: 'v', taskQueue: 'q' }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});
