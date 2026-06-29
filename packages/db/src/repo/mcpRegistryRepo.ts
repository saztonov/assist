/**
 * MCP registry repository. NODE-ONLY.
 *
 * Источник истины для управляемого MCP-реестра: серверы (metadata + snapshot),
 * их инструменты (allowlist), per-server permissions и история health-check'ов.
 * Хранит ТОЛЬКО `endpoint_secret_ref` (ссылку) — никогда сырой endpoint/секрет.
 * Включённые инструменты исполняются исключительно через Tool Broker (мост в
 * `@su10/mcp`); прямого пути исполнения нет.
 *
 * Инварианты:
 * - snapshot вставляет НОВЫЕ tool_name с `enabled=false` (переопределяя default
 *   схемы), существующие строки сохраняют `enabled`/`risk_level`;
 * - повтор того же snapshot → тот же `tools_snapshot_hash` (стабильный sha256).
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  mcpServers,
  mcpServerTools,
  mcpServerPermissions,
  mcpServerHealthChecks,
} from '../schema/mcp.js';
import type { Database } from '../index.js';

/** Уровень риска (локальный союз — без зависимости db→permissions). */
export type RiskLevel = 'low' | 'medium' | 'high';

export type McpServerRow = typeof mcpServers.$inferSelect;
export type McpServerToolRow = typeof mcpServerTools.$inferSelect;
export type McpServerPermissionRow = typeof mcpServerPermissions.$inferSelect;
export type McpServerHealthCheckRow = typeof mcpServerHealthChecks.$inferSelect;

export type McpPrincipalType = 'user' | 'role' | 'group';

/** Principal, запрашивающий доступ к MCP-серверу (subject из auth-слоя). */
export interface McpPrincipal {
  id: string;
  roles: string[];
}

export interface McpPermissionInput {
  principalType: McpPrincipalType;
  principalId: string;
  permission?: string;
}

export interface CreateMcpServerInput {
  key: string;
  name: string;
  transport?: string | null;
  /** Ссылка на секрет с endpoint — НЕ сырой endpoint/секрет. */
  endpointSecretRef?: string | null;
  riskLevel?: RiskLevel;
  allowed?: boolean;
  enabled?: boolean;
  permissions?: McpPermissionInput[];
}

/** Описание инструмента из tools/list (snapshot). */
export interface McpToolDescriptor {
  toolName: string;
  inputSchema?: unknown;
  riskLevel?: RiskLevel;
}

export interface SnapshotResult {
  hash: string;
  total: number;
  added: number;
  kept: number;
}

/** Включённый MCP tool (server allowed+enabled, tool enabled) — для моста в брокер. */
export interface EnabledMcpTool {
  serverId: string;
  serverKey: string;
  serverName: string;
  serverRiskLevel: string;
  endpointSecretRef: string | null;
  toolName: string;
  toolRiskLevel: string | null;
  inputSchema: unknown;
}

export interface RecordHealthCheckInput {
  serverId: string;
  status: 'ok' | 'error';
  latencyMs?: number | null;
  /** Безопасное краткое описание — без endpoint/секретов/сырых ошибок. */
  detail?: string | null;
}

export interface McpRegistryRepo {
  listServers(): Promise<McpServerRow[]>;
  getServer(id: string): Promise<McpServerRow | undefined>;
  createServer(input: CreateMcpServerInput): Promise<McpServerRow>;
  listTools(serverId: string): Promise<McpServerToolRow[]>;
  listEnabledTools(): Promise<EnabledMcpTool[]>;
  snapshotTools(serverId: string, tools: McpToolDescriptor[]): Promise<SnapshotResult>;
  setToolEnabled(
    serverId: string,
    toolName: string,
    enabled: boolean,
    riskLevel?: RiskLevel,
  ): Promise<McpServerToolRow | undefined>;
  listPermissions(serverId: string): Promise<McpServerPermissionRow[]>;
  recordHealthCheck(input: RecordHealthCheckInput): Promise<McpServerHealthCheckRow>;
  listHealthChecks(serverId: string, limit: number): Promise<McpServerHealthCheckRow[]>;
}

// ── Хэш snapshot'а ────────────────────────────────────────────────────────────

/** Стабильный (sorted-keys) sha256 — хранится только хэш, не сырьё. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Стабильный хэш tools/list: нормализуем к отсортированному по имени списку
 * `{ toolName, inputSchema }`. Порядок входа не влияет на результат.
 */
export function snapshotHash(tools: McpToolDescriptor[]): string {
  const normalized = [...tools]
    .map((t) => ({ toolName: t.toolName, inputSchema: t.inputSchema ?? null }))
    .sort((a, b) => a.toolName.localeCompare(b.toolName));
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

// ── Object-level authorization ─────────────────────────────────────────────────

/**
 * Может ли principal использовать MCP-сервер: admin, либо совпадающий permission
 * (user/role/group). Роли и группы матчатся против `principal.roles`. У MCP-сервера
 * нет владельца (в отличие от connector account).
 */
export function canUseMcpServer(
  principal: McpPrincipal,
  server: McpServerRow,
  permissions: McpServerPermissionRow[],
): boolean {
  if (principal.roles.includes('admin')) return true;
  return permissions.some((p) => {
    if (p.serverId !== server.id) return false;
    if (p.principalType === 'user') return p.principalId === principal.id;
    if (p.principalType === 'role' || p.principalType === 'group') {
      return principal.roles.includes(p.principalId);
    }
    return false;
  });
}

// ── DB implementation ──────────────────────────────────────────────────────────

export function createMcpRegistryRepo(db: Database): McpRegistryRepo {
  return {
    async listServers() {
      return db.select().from(mcpServers).orderBy(desc(mcpServers.createdAt));
    },

    async getServer(id) {
      const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1);
      return row;
    },

    async createServer(input) {
      return db.transaction(async (tx) => {
        const [server] = await tx
          .insert(mcpServers)
          .values({
            key: input.key,
            name: input.name,
            transport: input.transport ?? null,
            endpointSecretRef: input.endpointSecretRef ?? null,
            allowed: input.allowed ?? false,
            riskLevel: input.riskLevel ?? 'medium',
            enabled: input.enabled ?? false,
          })
          .returning();
        if (input.permissions?.length) {
          await tx.insert(mcpServerPermissions).values(
            input.permissions.map((p) => ({
              serverId: server.id,
              principalType: p.principalType,
              principalId: p.principalId,
              permission: p.permission ?? 'use',
            })),
          );
        }
        return server;
      });
    },

    async listTools(serverId) {
      return db.select().from(mcpServerTools).where(eq(mcpServerTools.serverId, serverId));
    },

    async listEnabledTools() {
      const rows = await db
        .select({
          serverId: mcpServers.id,
          serverKey: mcpServers.key,
          serverName: mcpServers.name,
          serverRiskLevel: mcpServers.riskLevel,
          endpointSecretRef: mcpServers.endpointSecretRef,
          toolName: mcpServerTools.toolName,
          toolRiskLevel: mcpServerTools.riskLevel,
          inputSchema: mcpServerTools.inputSchemaJson,
        })
        .from(mcpServerTools)
        .innerJoin(mcpServers, eq(mcpServerTools.serverId, mcpServers.id))
        .where(
          and(
            eq(mcpServers.allowed, true),
            eq(mcpServers.enabled, true),
            eq(mcpServerTools.enabled, true),
          ),
        );
      return rows;
    },

    async snapshotTools(serverId, tools) {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({ toolName: mcpServerTools.toolName })
          .from(mcpServerTools)
          .where(eq(mcpServerTools.serverId, serverId));
        const existingNames = new Set(existing.map((r) => r.toolName));

        let added = 0;
        let kept = 0;
        for (const t of tools) {
          if (existingNames.has(t.toolName)) {
            // Существующий tool: обновляем только схему; enabled/risk_level сохраняем.
            await tx
              .update(mcpServerTools)
              .set({ inputSchemaJson: (t.inputSchema ?? null) as object | null })
              .where(
                and(
                  eq(mcpServerTools.serverId, serverId),
                  eq(mcpServerTools.toolName, t.toolName),
                ),
              );
            kept += 1;
          } else {
            // Новый tool НЕ включается автоматически: enabled=false.
            await tx.insert(mcpServerTools).values({
              serverId,
              toolName: t.toolName,
              enabled: false,
              inputSchemaJson: (t.inputSchema ?? null) as object | null,
              riskLevel: t.riskLevel ?? null,
            });
            added += 1;
          }
        }

        const hash = snapshotHash(tools);
        await tx
          .update(mcpServers)
          .set({ toolsSnapshotHash: hash, toolsSnapshotAt: new Date(), updatedAt: new Date() })
          .where(eq(mcpServers.id, serverId));

        return { hash, total: tools.length, added, kept };
      });
    },

    async setToolEnabled(serverId, toolName, enabled, riskLevel) {
      const [row] = await db
        .update(mcpServerTools)
        .set({ enabled, ...(riskLevel ? { riskLevel } : {}) })
        .where(and(eq(mcpServerTools.serverId, serverId), eq(mcpServerTools.toolName, toolName)))
        .returning();
      return row;
    },

    async listPermissions(serverId) {
      return db
        .select()
        .from(mcpServerPermissions)
        .where(eq(mcpServerPermissions.serverId, serverId));
    },

    async recordHealthCheck(input) {
      const [row] = await db
        .insert(mcpServerHealthChecks)
        .values({
          serverId: input.serverId,
          status: input.status,
          latencyMs: input.latencyMs ?? null,
          detail: input.detail ?? null,
        })
        .returning();
      return row;
    },

    async listHealthChecks(serverId, limit) {
      return db
        .select()
        .from(mcpServerHealthChecks)
        .where(eq(mcpServerHealthChecks.serverId, serverId))
        .orderBy(desc(mcpServerHealthChecks.checkedAt))
        .limit(limit);
    },
  };
}

// ── In-memory implementation (tests) ─────────────────────────────────────────

export class InMemoryMcpRegistryRepo implements McpRegistryRepo {
  readonly servers: McpServerRow[] = [];
  readonly tools: McpServerToolRow[] = [];
  readonly permissions: McpServerPermissionRow[] = [];
  readonly healthChecks: McpServerHealthCheckRow[] = [];
  private clock = 0;

  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1) + this.clock++ * 1000);
  }

  async listServers() {
    return [...this.servers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getServer(id: string) {
    return this.servers.find((s) => s.id === id);
  }

  async createServer(input: CreateMcpServerInput) {
    const ts = this.now();
    const server: McpServerRow = {
      id: randomUUID(),
      key: input.key,
      name: input.name,
      transport: input.transport ?? null,
      endpointSecretRef: input.endpointSecretRef ?? null,
      allowed: input.allowed ?? false,
      riskLevel: input.riskLevel ?? 'medium',
      enabled: input.enabled ?? false,
      toolsSnapshotHash: null,
      toolsSnapshotAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.servers.push(server);
    for (const p of input.permissions ?? []) {
      this.permissions.push({
        id: randomUUID(),
        serverId: server.id,
        principalType: p.principalType,
        principalId: p.principalId,
        permission: p.permission ?? 'use',
        createdAt: ts,
      });
    }
    return server;
  }

  async listTools(serverId: string) {
    return this.tools.filter((t) => t.serverId === serverId);
  }

  async listEnabledTools(): Promise<EnabledMcpTool[]> {
    const out: EnabledMcpTool[] = [];
    for (const t of this.tools) {
      if (!t.enabled) continue;
      const s = this.servers.find((x) => x.id === t.serverId);
      if (!s || !s.allowed || !s.enabled) continue;
      out.push({
        serverId: s.id,
        serverKey: s.key,
        serverName: s.name,
        serverRiskLevel: s.riskLevel,
        endpointSecretRef: s.endpointSecretRef,
        toolName: t.toolName,
        toolRiskLevel: t.riskLevel,
        inputSchema: t.inputSchemaJson,
      });
    }
    return out;
  }

  async snapshotTools(serverId: string, tools: McpToolDescriptor[]): Promise<SnapshotResult> {
    let added = 0;
    let kept = 0;
    for (const t of tools) {
      const existing = this.tools.find((x) => x.serverId === serverId && x.toolName === t.toolName);
      if (existing) {
        existing.inputSchemaJson = (t.inputSchema ?? null) as object | null;
        kept += 1;
      } else {
        this.tools.push({
          id: randomUUID(),
          serverId,
          toolName: t.toolName,
          enabled: false,
          inputSchemaJson: (t.inputSchema ?? null) as object | null,
          riskLevel: t.riskLevel ?? null,
          createdAt: this.now(),
        });
        added += 1;
      }
    }
    const hash = snapshotHash(tools);
    const server = this.servers.find((s) => s.id === serverId);
    if (server) {
      server.toolsSnapshotHash = hash;
      server.toolsSnapshotAt = this.now();
      server.updatedAt = this.now();
    }
    return { hash, total: tools.length, added, kept };
  }

  async setToolEnabled(
    serverId: string,
    toolName: string,
    enabled: boolean,
    riskLevel?: RiskLevel,
  ) {
    const tool = this.tools.find((t) => t.serverId === serverId && t.toolName === toolName);
    if (!tool) return undefined;
    tool.enabled = enabled;
    if (riskLevel) tool.riskLevel = riskLevel;
    return tool;
  }

  async listPermissions(serverId: string) {
    return this.permissions.filter((p) => p.serverId === serverId);
  }

  async recordHealthCheck(input: RecordHealthCheckInput) {
    const row: McpServerHealthCheckRow = {
      id: randomUUID(),
      serverId: input.serverId,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      detail: input.detail ?? null,
      checkedAt: this.now(),
    };
    this.healthChecks.push(row);
    return row;
  }

  async listHealthChecks(serverId: string, limit: number) {
    return this.healthChecks
      .filter((h) => h.serverId === serverId)
      .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())
      .slice(0, limit);
  }
}
