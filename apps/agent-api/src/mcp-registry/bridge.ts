/**
 * Мост MCP registry → Tool Broker (app-слой). Маппит строки репозитория в
 * `McpToolRegistration` и регистрирует включённые tools в ToolRegistry. Live
 * re-check (allowlist + per-server ACL) выполняется в `authorize` на момент вызова.
 */
import type { AuditSink } from '@su10/audit';
import {
  canUseMcpServer,
  type McpRegistryRepo,
  type McpServerRow,
  type McpServerPermissionRow,
} from '@su10/db';
import {
  mcpToolName,
  registerMcpTool,
  unregisterMcpTool,
  type McpClientPort,
  type McpServerRef,
  type McpToolRegistration,
  type RegisterMcpToolsDeps,
} from '@su10/mcp';
import type { RiskLevel, Subject } from '@su10/permissions';
import type { ToolRegistry } from '@su10/tools';

export interface McpRegistryDeps {
  mcpRepo: McpRegistryRepo;
  mcpClient: McpClientPort;
  toolRegistry: ToolRegistry;
  auditSink: AuditSink;
}

function serverRefOf(s: McpServerRow): McpServerRef {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    riskLevel: s.riskLevel as RiskLevel,
    endpointSecretRef: s.endpointSecretRef,
  };
}

/** allowedRoles брокера из role/group-permissions сервера. */
function allowedRolesOf(perms: McpServerPermissionRow[]): string[] {
  return perms
    .filter((p) => p.principalType === 'role' || p.principalType === 'group')
    .map((p) => p.principalId);
}

/** Live re-check на момент вызова: allowlist + tool.enabled + per-server ACL. */
function buildAuthorize(repo: McpRegistryRepo): RegisterMcpToolsDeps['authorize'] {
  return async (subject: Subject, reg: McpToolRegistration) => {
    const server = await repo.getServer(reg.server.id);
    if (!server || !server.allowed || !server.enabled) return false;
    const tool = (await repo.listTools(server.id)).find((t) => t.toolName === reg.toolName);
    if (!tool || !tool.enabled) return false;
    const perms = await repo.listPermissions(server.id);
    return canUseMcpServer({ id: subject.id, roles: subject.roles }, server, perms);
  };
}

function regDeps(deps: McpRegistryDeps): RegisterMcpToolsDeps {
  return { client: deps.mcpClient, authorize: buildAuthorize(deps.mcpRepo) };
}

/**
 * Регистрирует в ToolRegistry все включённые MCP tools (server allowed+enabled,
 * tool enabled). Возвращает число зарегистрированных. Идемпотентно (перезапись).
 */
export async function syncEnabledMcpTools(deps: McpRegistryDeps): Promise<number> {
  const enabled = await deps.mcpRepo.listEnabledTools();
  const rdeps = regDeps(deps);
  const permCache = new Map<string, McpServerPermissionRow[]>();
  for (const e of enabled) {
    let perms = permCache.get(e.serverId);
    if (!perms) {
      perms = await deps.mcpRepo.listPermissions(e.serverId);
      permCache.set(e.serverId, perms);
    }
    const reg: McpToolRegistration = {
      server: {
        id: e.serverId,
        key: e.serverKey,
        name: e.serverName,
        riskLevel: e.serverRiskLevel as RiskLevel,
        endpointSecretRef: e.endpointSecretRef,
      },
      toolName: e.toolName,
      riskLevel: (e.toolRiskLevel ?? e.serverRiskLevel) as RiskLevel,
      allowedRoles: allowedRolesOf(perms),
    };
    registerMcpTool(deps.toolRegistry, reg, rdeps);
  }
  return enabled.length;
}

/**
 * Синхронизирует регистрацию одного tool после смены флага: регистрирует, если
 * `server.allowed && server.enabled && tool.enabled`, иначе снимает с регистрации.
 */
export async function syncMcpToolRegistration(
  deps: McpRegistryDeps,
  serverId: string,
  toolName: string,
): Promise<void> {
  const server = await deps.mcpRepo.getServer(serverId);
  if (!server) return;
  const tool = (await deps.mcpRepo.listTools(serverId)).find((t) => t.toolName === toolName);
  const shouldRegister = !!tool && tool.enabled && server.allowed && server.enabled;
  if (shouldRegister) {
    const perms = await deps.mcpRepo.listPermissions(serverId);
    const reg: McpToolRegistration = {
      server: serverRefOf(server),
      toolName,
      riskLevel: (tool.riskLevel ?? server.riskLevel) as RiskLevel,
      allowedRoles: allowedRolesOf(perms),
    };
    registerMcpTool(deps.toolRegistry, reg, regDeps(deps));
  } else {
    unregisterMcpTool(deps.toolRegistry, server.key, toolName);
  }
}

export { mcpToolName };
