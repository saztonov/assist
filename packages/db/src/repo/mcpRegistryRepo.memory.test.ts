import { describe, it, expect } from 'vitest';
import {
  InMemoryMcpRegistryRepo,
  canUseMcpServer,
  snapshotHash,
  type McpServerRow,
} from './mcpRegistryRepo.js';

function makeServer(over: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: 's-1',
    key: 'k',
    name: 'n',
    transport: null,
    endpointSecretRef: null,
    allowed: false,
    riskLevel: 'medium',
    enabled: false,
    toolsSnapshotHash: null,
    toolsSnapshotAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('snapshotHash', () => {
  it('стабилен независимо от порядка инструментов', () => {
    const a = snapshotHash([
      { toolName: 'b', inputSchema: { type: 'object' } },
      { toolName: 'a' },
    ]);
    const b = snapshotHash([
      { toolName: 'a' },
      { toolName: 'b', inputSchema: { type: 'object' } },
    ]);
    expect(a).toBe(b);
  });

  it('меняется при изменении схемы', () => {
    const a = snapshotHash([{ toolName: 'a', inputSchema: { type: 'object' } }]);
    const b = snapshotHash([{ toolName: 'a', inputSchema: { type: 'string' } }]);
    expect(a).not.toBe(b);
  });
});

describe('InMemoryMcpRegistryRepo.snapshotTools', () => {
  it('новые tools вставляются disabled; повтор → тот же hash; enabled сохраняется', async () => {
    const repo = new InMemoryMcpRegistryRepo();
    const server = await repo.createServer({ key: 'srv', name: 'Srv', allowed: true });

    const r1 = await repo.snapshotTools(server.id, [
      { toolName: 'alpha' },
      { toolName: 'beta' },
    ]);
    expect(r1).toMatchObject({ total: 2, added: 2, kept: 0 });
    let tools = await repo.listTools(server.id);
    expect(tools.every((t) => t.enabled === false)).toBe(true);

    // Включаем alpha вручную.
    await repo.setToolEnabled(server.id, 'alpha', true);

    // Повторный snapshot тех же tools — тот же hash, enabled не сброшен.
    const r2 = await repo.snapshotTools(server.id, [
      { toolName: 'beta' },
      { toolName: 'alpha' },
    ]);
    expect(r2.hash).toBe(r1.hash);
    expect(r2).toMatchObject({ added: 0, kept: 2 });
    tools = await repo.listTools(server.id);
    expect(tools.find((t) => t.toolName === 'alpha')?.enabled).toBe(true);

    // Новый tool в snapshot — disabled, hash меняется.
    const r3 = await repo.snapshotTools(server.id, [
      { toolName: 'alpha' },
      { toolName: 'beta' },
      { toolName: 'gamma' },
    ]);
    expect(r3.added).toBe(1);
    expect(r3.hash).not.toBe(r1.hash);
    tools = await repo.listTools(server.id);
    expect(tools.find((t) => t.toolName === 'gamma')?.enabled).toBe(false);
  });
});

describe('InMemoryMcpRegistryRepo.listEnabledTools', () => {
  it('фильтрует по server.allowed && server.enabled && tool.enabled', async () => {
    const repo = new InMemoryMcpRegistryRepo();

    const allowedEnabled = await repo.createServer({ key: 's-ok', name: 'ok', allowed: true });
    allowedEnabled.enabled = true; // имитируем включённый сервер
    await repo.snapshotTools(allowedEnabled.id, [{ toolName: 't1' }, { toolName: 't2' }]);
    await repo.setToolEnabled(allowedEnabled.id, 't1', true);

    const notAllowed = await repo.createServer({ key: 's-na', name: 'na', allowed: false });
    notAllowed.enabled = true;
    await repo.snapshotTools(notAllowed.id, [{ toolName: 'x' }]);
    await repo.setToolEnabled(notAllowed.id, 'x', true);

    const enabled = await repo.listEnabledTools();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({ serverKey: 's-ok', toolName: 't1' });
  });
});

describe('canUseMcpServer', () => {
  it('admin всегда может', () => {
    expect(canUseMcpServer({ id: 'u', roles: ['admin'] }, makeServer(), [])).toBe(true);
  });

  it('по role/group/user permission', () => {
    const server = makeServer({ id: 's-9' });
    const perms = [
      {
        id: 'p1',
        serverId: 's-9',
        principalType: 'role' as const,
        principalId: 'mcp.user',
        permission: 'use',
        createdAt: new Date(),
      },
    ];
    expect(canUseMcpServer({ id: 'u', roles: ['mcp.user'] }, server, perms)).toBe(true);
    expect(canUseMcpServer({ id: 'u', roles: [] }, server, perms)).toBe(false);
  });

  it('без permission и не admin — нельзя', () => {
    expect(canUseMcpServer({ id: 'u', roles: [] }, makeServer(), [])).toBe(false);
  });
});
