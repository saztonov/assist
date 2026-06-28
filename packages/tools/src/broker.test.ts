import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { InMemoryAuditSink } from '@su10/audit';
import {
  AuthzError,
  NotFoundError,
  ToolApprovalRequiredError,
  UpstreamError,
  ValidationError,
} from '@su10/errors';
import { ToolBroker } from './broker.js';
import { ToolRegistry } from './registry.js';
import { InMemoryToolCallRecorder } from './recorder.js';
import type { ToolContext, ToolDefinition } from './types.js';

function makeTool(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'echo',
    version: 1,
    description: 'Echoes',
    category: 'system',
    riskLevel: 'low',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    timeoutMs: 1000,
    async handler(input) {
      return input;
    },
    ...over,
  };
}

interface Harness {
  broker: ToolBroker;
  audit: InMemoryAuditSink;
  recorder: InMemoryToolCallRecorder;
}

function harness(tool: ToolDefinition, opts: ConstructorParameters<typeof ToolBroker>[1] = {}): Harness {
  const registry = new ToolRegistry();
  registry.register(tool);
  const recorder = new InMemoryToolCallRecorder();
  const broker = new ToolBroker(registry, { recorder, ...opts });
  return { broker, audit: new InMemoryAuditSink(), recorder };
}

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    subject: { id: 'u-1', roles: ['echo'] },
    auditSink: new InMemoryAuditSink(),
    at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('ToolBroker pipeline', () => {
  it('успех: возвращает выход, пишет audit(success) + call-log с хэшами', async () => {
    const { broker, recorder } = harness(makeTool());
    const auditSink = new InMemoryAuditSink();
    const out = await broker.invoke('echo', { text: 'hi' }, ctx({ auditSink }));
    expect(out).toEqual({ text: 'hi' });
    expect(recorder.records).toHaveLength(1);
    const rec = recorder.records[0];
    expect(rec.status).toBe('success');
    expect(rec.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rec.outputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(auditSink.events[0]).toMatchObject({ action: 'echo', outcome: 'success' });
  });

  it('неизвестный инструмент → NotFoundError, call-log failure/NOT_FOUND', async () => {
    const { broker, recorder } = harness(makeTool());
    await expect(broker.invoke('missing', {}, ctx())).rejects.toBeInstanceOf(NotFoundError);
    expect(recorder.records[0]).toMatchObject({ status: 'failure', redactedErrorCode: 'NOT_FOUND' });
  });

  it('невалидный вход → ValidationError, без inputHash', async () => {
    const { broker, recorder } = harness(makeTool());
    await expect(broker.invoke('echo', { text: 123 }, ctx())).rejects.toBeInstanceOf(ValidationError);
    expect(recorder.records[0]).toMatchObject({
      status: 'failure',
      redactedErrorCode: 'VALIDATION_FAILED',
    });
    expect(recorder.records[0].inputHash).toBeUndefined();
  });

  it('отказ доступа → AuthzError (НЕ approval), call-log denied', async () => {
    const { broker, recorder } = harness(makeTool());
    await expect(
      broker.invoke('echo', { text: 'x' }, ctx({ subject: { id: 'u', roles: [] } })),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(recorder.records[0]).toMatchObject({ status: 'denied', redactedErrorCode: 'AUTHZ_DENIED' });
  });

  it('allowedRoles: без роли — deny; admin — байпас', async () => {
    const tool = makeTool({ name: 'priv', allowedRoles: ['approver'] });
    const { broker } = harness(tool);
    await expect(
      broker.invoke('priv', { text: 'x' }, ctx({ subject: { id: 'u', roles: ['priv'] } })),
    ).rejects.toBeInstanceOf(AuthzError);
    const out = await broker.invoke('priv', { text: 'x' }, ctx({ subject: { id: 'a', roles: ['admin'] } }));
    expect(out).toEqual({ text: 'x' });
  });

  it('high-risk без approval → ToolApprovalRequiredError, handler НЕ запускался', async () => {
    let ran = false;
    const tool = makeTool({
      name: 'danger',
      riskLevel: 'high',
      async handler(i) {
        ran = true;
        return i;
      },
    });
    const { broker, recorder } = harness(tool);
    await expect(
      broker.invoke('danger', { text: 'x' }, ctx({ subject: { id: 'u', roles: ['danger'] } })),
    ).rejects.toBeInstanceOf(ToolApprovalRequiredError);
    expect(ran).toBe(false);
    expect(recorder.records[0].status).toBe('approval_required');
  });

  it('high-risk с approved=true → выполняется', async () => {
    const tool = makeTool({ name: 'danger', riskLevel: 'high' });
    const { broker } = harness(tool);
    const out = await broker.invoke(
      'danger',
      { text: 'x' },
      ctx({ subject: { id: 'u', roles: ['danger'] }, approved: true }),
    );
    expect(out).toEqual({ text: 'x' });
  });

  it('autoApproveRoles из policyResolver пропускает approval', async () => {
    const tool = makeTool({ name: 'danger', riskLevel: 'high' });
    const { broker } = harness(tool, {
      policyResolver: { resolve: () => ({ requiresApproval: true, autoApproveRoles: ['approver'] }) },
    });
    const out = await broker.invoke(
      'danger',
      { text: 'x' },
      ctx({ subject: { id: 'u', roles: ['danger', 'approver'] } }),
    );
    expect(out).toEqual({ text: 'x' });
  });

  it('таймаут → UpstreamError, call-log failure/UPSTREAM_ERROR', async () => {
    const tool = makeTool({
      name: 'slow',
      timeoutMs: 10,
      async handler() {
        await new Promise((r) => setTimeout(r, 1000));
        return { text: 'late' };
      },
    });
    const { broker, recorder } = harness(tool);
    await expect(
      broker.invoke('slow', { text: 'x' }, ctx({ subject: { id: 'u', roles: ['slow'] } })),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(recorder.records[0]).toMatchObject({
      status: 'failure',
      redactedErrorCode: 'UPSTREAM_ERROR',
    });
  });

  it('невалидный выход → ValidationError (inputHash есть, outputHash нет)', async () => {
    const tool = makeTool({
      name: 'bad-out',
      async handler() {
        return { wrong: true } as unknown as { text: string };
      },
    });
    const { broker, recorder } = harness(tool);
    await expect(
      broker.invoke('bad-out', { text: 'x' }, ctx({ subject: { id: 'u', roles: ['bad-out'] } })),
    ).rejects.toBeInstanceOf(ValidationError);
    const rec = recorder.records[0];
    expect(rec.status).toBe('failure');
    expect(rec.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rec.outputHash).toBeUndefined();
  });

  it('audit и call-log не содержат сырья (только хэши/коды)', async () => {
    const auditSink = new InMemoryAuditSink();
    const { broker, recorder } = harness(makeTool());
    await broker.invoke('echo', { text: 'СЕКРЕТНЫЙ-ТЕКСТ' }, ctx({ auditSink }));
    const blob = JSON.stringify({ audit: auditSink.events, rec: recorder.records });
    expect(blob).not.toContain('СЕКРЕТНЫЙ-ТЕКСТ');
  });
});
