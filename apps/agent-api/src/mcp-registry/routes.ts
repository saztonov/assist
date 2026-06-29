/**
 * MCP Registry REST (admin-only). Управление управляемым MCP-реестром:
 *  - список серверов (без секретов);
 *  - регистрация сервера (secretRef only);
 *  - health-check (stub-клиент, безопасные ошибки);
 *  - snapshot tools/list (новые tools НЕ включаются автоматически);
 *  - enable/disable конкретного tool + синхронизация ToolRegistry (broker path).
 * Регистрируется только при наличии deps. Внутри authed-scope.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit } from '@su10/audit';
import { NotFoundError } from '@su10/errors';
import { MCP_REGISTRY_ACTIONS } from '../audit/auditActions.js';
import { authOf, requireMcpManage } from './access.js';
import { syncMcpToolRegistration, type McpRegistryDeps } from './bridge.js';
import {
  CreateMcpServerBody,
  HealthCheckResponse,
  ListMcpServersResponse,
  McpServerCardSchema,
  McpServerIdParams,
  SnapshotToolsResponse,
  ToolEnableBody,
  ToolEnableParams,
  ToolEnableResponse,
  toMcpServerCard,
} from './dto.js';

export type { McpRegistryDeps } from './bridge.js';

const nowIso = (): string => new Date().toISOString();

export const mcpRegistryRoutes: FastifyPluginAsync<McpRegistryDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { mcpRepo, mcpClient, auditSink } = deps;

  // GET /mcp/servers — список серверов (admin), без секретов.
  app.get(
    '/mcp/servers',
    {
      schema: {
        tags: ['mcp'],
        summary: 'Список MCP-серверов (admin, без секретов)',
        response: { 200: ListMcpServersResponse },
      },
    },
    async (req) => {
      requireMcpManage(authOf(req));
      const servers = await mcpRepo.listServers();
      return { servers: servers.map(toMcpServerCard) };
    },
  );

  // POST /mcp/servers — регистрация сервера (secretRef only).
  app.post(
    '/mcp/servers',
    {
      schema: {
        tags: ['mcp'],
        summary: 'Зарегистрировать MCP-сервер (secretRef, без raw-секрета)',
        body: CreateMcpServerBody,
        response: { 201: McpServerCardSchema },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      requireMcpManage(auth);
      const b = req.body;
      const server = await mcpRepo.createServer({
        key: b.key,
        name: b.name,
        transport: b.transport ?? null,
        endpointSecretRef: b.endpointSecretRef ?? null,
        riskLevel: b.riskLevel,
        allowed: b.allowed,
        enabled: b.enabled,
        ...(b.permissions ? { permissions: b.permissions } : {}),
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: MCP_REGISTRY_ACTIONS.serverCreate,
        resource: `mcp:server:${server.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { serverId: server.id, key: server.key, allowed: server.allowed },
      });
      return reply.code(201).send(toMcpServerCard(server));
    },
  );

  // POST /mcp/servers/:id/health-check — ping через stub-клиент, безопасные ошибки.
  app.post(
    '/mcp/servers/:id/health-check',
    {
      schema: {
        tags: ['mcp'],
        summary: 'Health-check MCP-сервера',
        params: McpServerIdParams,
        response: { 200: HealthCheckResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      requireMcpManage(auth);
      const server = await loadServer(deps, req.params.id);
      let ok = false;
      let latencyMs: number | null = null;
      let detail = 'health check failed';
      try {
        const res = await mcpClient.ping({
          id: server.id,
          key: server.key,
          name: server.name,
          riskLevel: server.riskLevel as 'low' | 'medium' | 'high',
          endpointSecretRef: server.endpointSecretRef,
        });
        ok = res.ok;
        latencyMs = res.latencyMs;
        detail = res.detail ?? (ok ? 'ok' : 'error');
      } catch {
        ok = false; // никогда не утечь сырую upstream-ошибку
      }
      const status = ok ? 'ok' : 'error';
      await mcpRepo.recordHealthCheck({ serverId: server.id, status, latencyMs, detail });
      await audit(auditSink, {
        actor: auth.sub,
        action: MCP_REGISTRY_ACTIONS.healthCheck,
        resource: `mcp:server:${server.id}`,
        outcome: ok ? 'success' : 'failure',
        at: nowIso(),
        meta: { serverId: server.id, status },
      });
      return { ok, status, latencyMs };
    },
  );

  // POST /mcp/servers/:id/snapshot-tools — снять tools/list; новые → disabled.
  app.post(
    '/mcp/servers/:id/snapshot-tools',
    {
      schema: {
        tags: ['mcp'],
        summary: 'Snapshot tools/list (новые tools не включаются автоматически)',
        params: McpServerIdParams,
        response: { 200: SnapshotToolsResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      requireMcpManage(auth);
      const server = await loadServer(deps, req.params.id);
      const tools = await mcpClient.listTools({
        id: server.id,
        key: server.key,
        name: server.name,
        riskLevel: server.riskLevel as 'low' | 'medium' | 'high',
        endpointSecretRef: server.endpointSecretRef,
      });
      const result = await mcpRepo.snapshotTools(
        server.id,
        tools.map((t) => ({ toolName: t.name, inputSchema: t.inputSchema })),
      );
      await audit(auditSink, {
        actor: auth.sub,
        action: MCP_REGISTRY_ACTIONS.snapshotTools,
        resource: `mcp:server:${server.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { serverId: server.id, hash: result.hash, total: result.total, added: result.added },
      });
      return result;
    },
  );

  // PATCH /mcp/servers/:id/tools/:toolName/enable — enable/disable + sync registry.
  app.patch(
    '/mcp/servers/:id/tools/:toolName/enable',
    {
      schema: {
        tags: ['mcp'],
        summary: 'Включить/выключить MCP tool (проходит через Tool Broker)',
        params: ToolEnableParams,
        body: ToolEnableBody,
        response: { 200: ToolEnableResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      requireMcpManage(auth);
      const server = await loadServer(deps, req.params.id);
      const updated = await mcpRepo.setToolEnabled(
        server.id,
        req.params.toolName,
        req.body.enabled,
        req.body.riskLevel,
      );
      if (!updated) throw new NotFoundError('mcp tool not found');
      // Синхронизация ToolRegistry в текущем процессе (broker path).
      await syncMcpToolRegistration(deps, server.id, req.params.toolName);
      await audit(auditSink, {
        actor: auth.sub,
        action: req.body.enabled
          ? MCP_REGISTRY_ACTIONS.toolEnable
          : MCP_REGISTRY_ACTIONS.toolDisable,
        resource: `mcp:tool:${server.key}:${req.params.toolName}`,
        outcome: 'success',
        at: nowIso(),
        meta: { serverId: server.id, toolName: req.params.toolName, enabled: req.body.enabled },
      });
      return { toolName: updated.toolName, enabled: updated.enabled, riskLevel: updated.riskLevel };
    },
  );
};

/** Загружает сервер или 404. */
async function loadServer(deps: McpRegistryDeps, id: string) {
  const server = await deps.mcpRepo.getServer(id);
  if (!server) throw new NotFoundError('mcp server not found');
  return server;
}
