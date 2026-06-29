import { describe, it, expect } from 'vitest';
import { InMemoryAuditSink } from '@su10/audit';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import type { Subject } from '@su10/permissions';
import {
  InMemoryMcpClient,
  McpRegistry,
  mcpToolName,
  registerMcpTool,
  unregisterMcpTool,
  type McpServerRef,
  type McpToolRegistration,
  type RegisterMcpToolsDeps,
} from './index.js';

const server: McpServerRef = {
  id: 'srv-1',
  key: 'srv',
  name: 'Srv',
  riskLevel: 'low',
  endpointSecretRef: 'env:MCP_SRV',
};

const reg: McpToolRegistration = {
  server,
  toolName: 'echo',
  riskLevel: 'low',
  allowedRoles: ['mcp.user'],
};

const admin: Subject = { id: 'a', roles: ['admin'] };

function deps(authorize: boolean, client = new InMemoryMcpClient()): RegisterMcpToolsDeps {
  return { client, authorize: () => authorize };
}

describe('mcp registry (server allowlist)', () => {
  it('only treats allowlisted servers as callable', () => {
    const r = new McpRegistry();
    r.register({ id: 'srv-a', url: 'http://a', allowed: true, riskLevel: 'low' });
    r.register({ id: 'srv-b', url: 'http://b', allowed: false, riskLevel: 'high' });
    expect(r.isAllowed('srv-a')).toBe(true);
    expect(r.isAllowed('srv-b')).toBe(false);
    expect(r.isAllowed('unknown')).toBe(false);
  });
});

describe('registerMcpTool / unregisterMcpTool', () => {
  it('регистрирует ToolDefinition под именем mcp:<key>:<tool> и снимает', () => {
    const registry = new ToolRegistry();
    const name = registerMcpTool(registry, reg, deps(true));
    expect(name).toBe(mcpToolName('srv', 'echo'));
    expect(registry.has(name)).toBe(true);
    expect(registry.get(name)?.category).toBe('connector');

    expect(unregisterMcpTool(registry, 'srv', 'echo')).toBe(true);
    expect(registry.has(name)).toBe(false);
  });
});

describe('MCP tool через Tool Broker', () => {
  it('enabled+authorized → вызывает stub-клиент, эмитит audit', async () => {
    const registry = new ToolRegistry();
    const client = new InMemoryMcpClient({ callResults: { 'srv:echo': { value: 42 } } });
    const name = registerMcpTool(registry, reg, deps(true, client));

    const broker = new ToolBroker(registry);
    const audit = new InMemoryAuditSink();
    const out = await broker.invoke(name, { a: 1 }, {
      subject: admin,
      auditSink: audit,
      at: '2026-06-30T00:00:00.000Z',
    });

    expect(out).toEqual({ value: 42 });
    expect(audit.events.some((e) => e.action === name && e.outcome === 'success')).toBe(true);
  });

  it('not-authorized → AuthzError, исполнения нет (audit denied/failure)', async () => {
    const registry = new ToolRegistry();
    const name = registerMcpTool(registry, reg, deps(false));
    const broker = new ToolBroker(registry);
    const audit = new InMemoryAuditSink();

    await expect(
      broker.invoke(name, {}, { subject: admin, auditSink: audit, at: '2026-06-30T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'AUTHZ_DENIED' });
  });
});
