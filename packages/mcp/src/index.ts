/**
 * Managed MCP registry bridge. NODE-ONLY.
 *
 * Включённые MCP-инструменты исполняются ИСКЛЮЧИТЕЛЬНО через Tool Broker: мост
 * регистрирует их как `ToolDefinition` (`mcp:<serverKey>:<toolName>`) в ToolRegistry.
 * Прямого пути исполнения MCP нет. Сетевой клиент абстрагирован за `McpClientPort`;
 * в v1 используется `InMemoryMcpClient` (stub), реальный HTTP/stdio-клиент — отдельный
 * этап развёртывания. Endpoint резолвится из `endpoint_secret_ref` (ссылка), а не из
 * сырого значения.
 */
import { z } from 'zod';
import type { RiskLevel, Subject } from '@su10/permissions';
import { AuthzError } from '@su10/errors';
import type { ToolDefinition, ToolRegistry } from '@su10/tools';

// ── Дескрипторы ────────────────────────────────────────────────────────────────

/** Ссылка на MCP-сервер (без сырого endpoint/секрета). */
export interface McpServerRef {
  id: string;
  key: string;
  name: string;
  riskLevel: RiskLevel;
  /** Ссылка на секрет с endpoint — резолвится клиентом, не логируется. */
  endpointSecretRef: string | null;
}

export interface McpPingResult {
  ok: boolean;
  latencyMs: number;
  /** Безопасное краткое описание — без endpoint/секретов/сырых ошибок. */
  detail?: string;
}

/** Инструмент из tools/list. */
export interface McpToolDescriptor {
  name: string;
  inputSchema?: unknown;
}

/**
 * Контракт связи с MCP-сервером. Реальная реализация (HTTP/stdio JSON-RPC) —
 * отдельный этап; в v1 — `InMemoryMcpClient`.
 */
export interface McpClientPort {
  ping(server: McpServerRef): Promise<McpPingResult>;
  listTools(server: McpServerRef): Promise<McpToolDescriptor[]>;
  callTool(server: McpServerRef, toolName: string, input: unknown): Promise<unknown>;
}

// ── Мост в Tool Broker ───────────────────────────────────────────────────────

/** Данные для регистрации одного включённого MCP-инструмента. */
export interface McpToolRegistration {
  server: McpServerRef;
  toolName: string;
  riskLevel: RiskLevel;
  /** Роли из per-server permissions (role/group) — дополнительный гейт брокера. */
  allowedRoles: string[];
  timeoutMs?: number;
}

export interface RegisterMcpToolsDeps {
  client: McpClientPort;
  /**
   * Live-проверка на момент вызова (data boundary): allowlist
   * (`server.allowed && server.enabled && tool.enabled`) + `canUseMcpServer`.
   * Возврат false → `AuthzError`, исполнения нет.
   */
  authorize(subject: Subject, reg: McpToolRegistration): boolean | Promise<boolean>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Имя tool в реестре: `mcp:<serverKey>:<toolName>`. */
export function mcpToolName(serverKey: string, toolName: string): string {
  return `mcp:${serverKey}:${toolName}`;
}

/**
 * Строит `ToolDefinition` для включённого MCP-инструмента. I/O-схемы в v1 —
 * passthrough (`z.unknown()`): JSON Schema из MCP не конвертируется в Zod на этом
 * этапе (broker всё равно хеширует/логирует I/O).
 */
export function buildMcpToolDefinition(
  reg: McpToolRegistration,
  deps: RegisterMcpToolsDeps,
): ToolDefinition {
  return {
    name: mcpToolName(reg.server.key, reg.toolName),
    version: 1,
    description: `MCP tool ${reg.toolName} @ ${reg.server.name}`,
    category: 'connector',
    riskLevel: reg.riskLevel,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    ...(reg.allowedRoles.length ? { allowedRoles: reg.allowedRoles } : {}),
    timeoutMs: reg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    async handler(input, ctx) {
      // Re-check на data boundary: allowlist + per-server ACL.
      const ok = await deps.authorize(ctx.subject, reg);
      if (!ok) throw new AuthzError(`MCP tool "${reg.toolName}" is not allowed`);
      return deps.client.callTool(reg.server, reg.toolName, input);
    },
  };
}

/** Регистрирует один включённый MCP-инструмент (idempotent: перезапись по имени). */
export function registerMcpTool(
  registry: ToolRegistry,
  reg: McpToolRegistration,
  deps: RegisterMcpToolsDeps,
): string {
  const def = buildMcpToolDefinition(reg, deps);
  registry.register(def);
  return def.name;
}

/** Регистрирует набор включённых MCP-инструментов. Возвращает их имена. */
export function registerMcpTools(
  registry: ToolRegistry,
  regs: McpToolRegistration[],
  deps: RegisterMcpToolsDeps,
): string[] {
  return regs.map((reg) => registerMcpTool(registry, reg, deps));
}

/** Снимает MCP-инструмент с регистрации (для disable в runtime). */
export function unregisterMcpTool(
  registry: ToolRegistry,
  serverKey: string,
  toolName: string,
): boolean {
  return registry.unregister(mcpToolName(serverKey, toolName));
}

// ── In-memory stub-клиент (v1, тесты/локаль) ──────────────────────────────────

export interface InMemoryMcpClientConfig {
  /** Карта serverKey → список инструментов (для listTools). */
  tools?: Record<string, McpToolDescriptor[]>;
  /** Карта serverKey → ok-флаг ping (по умолчанию true). */
  ping?: Record<string, boolean>;
  /** Карта `serverKey:toolName` → результат callTool. */
  callResults?: Record<string, unknown>;
}

/**
 * Детерминированный stub `McpClientPort` — без сетевых вызовов. latency=0,
 * callTool возвращает echo-результат, если явный не задан.
 */
export class InMemoryMcpClient implements McpClientPort {
  constructor(private readonly config: InMemoryMcpClientConfig = {}) {}

  async ping(server: McpServerRef): Promise<McpPingResult> {
    const ok = this.config.ping?.[server.key] ?? true;
    return { ok, latencyMs: 0, detail: ok ? 'stub ok' : 'stub error' };
  }

  async listTools(server: McpServerRef): Promise<McpToolDescriptor[]> {
    return this.config.tools?.[server.key] ?? [];
  }

  async callTool(server: McpServerRef, toolName: string, input: unknown): Promise<unknown> {
    const key = `${server.key}:${toolName}`;
    if (this.config.callResults && key in this.config.callResults) {
      return this.config.callResults[key];
    }
    return { ok: true, echo: input };
  }
}

// ── Backward-compatible in-memory allowlist (server-level) ────────────────────

export interface McpServerDescriptor {
  id: string;
  url: string;
  allowed: boolean;
  riskLevel: RiskLevel;
}

/** Лёгкий in-memory allowlist по серверам (источник истины — PostgreSQL). */
export class McpRegistry {
  private readonly servers = new Map<string, McpServerDescriptor>();
  private readonly allowlist = new Set<string>();

  register(desc: McpServerDescriptor): void {
    this.servers.set(desc.id, desc);
    if (desc.allowed) this.allowlist.add(desc.id);
  }

  /** Non-allowlisted MCP servers MUST NOT be callable. */
  isAllowed(id: string): boolean {
    return this.allowlist.has(id);
  }

  get(id: string): McpServerDescriptor | undefined {
    return this.servers.get(id);
  }

  list(): McpServerDescriptor[] {
    return [...this.servers.values()];
  }
}
