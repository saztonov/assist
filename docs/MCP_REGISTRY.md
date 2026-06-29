# Managed MCP Registry v1

Управляемый реестр MCP-серверов: регистрация серверов, snapshot их инструментов,
ручное включение конкретных tools и исполнение включённых MCP tools **только через
Tool Broker** (инварианты TOOL‑6/TOOL‑7).

## Источник истины

PostgreSQL (`agent_platform_db`):

- `mcp_servers` — метаданные сервера + `allowed` (allowlist), `enabled` (активен),
  `endpoint_secret_ref` (ссылка на секрет с endpoint), `tools_snapshot_hash`/`_at`.
- `mcp_server_tools` — снимок tools/list; `enabled` per-tool, `risk_level`, `input_schema_json`.
- `mcp_server_permissions` — per-server ACL (`user`/`role`/`group`).
- `mcp_server_health_checks` — история health-check'ов (`status`, `latency_ms`, `detail`).

ToolRegistry процесса — **производная**: на старте восстанавливается из БД
(`syncEnabledMcpTools`).

## REST API (admin-only, `/api/v1/mcp`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/mcp/servers` | список серверов (без секретов) |
| POST | `/mcp/servers` | регистрация сервера (`endpointSecretRef`, без raw-секрета) |
| POST | `/mcp/servers/:id/health-check` | ping → запись истории (безопасные ошибки) |
| POST | `/mcp/servers/:id/snapshot-tools` | снять tools/list; **новые tools НЕ включаются автоматически** |
| PATCH | `/mcp/servers/:id/tools/:toolName/enable` | включить/выключить tool + sync ToolRegistry |

Все мутации требуют роль `admin` или `mcp.manage`.

## Исполнение через Tool Broker

Включённый tool (`server.allowed && server.enabled && tool.enabled`) регистрируется
как `ToolDefinition` `mcp:<serverKey>:<toolName>` и вызывается **исключительно** через
`ToolBroker.invoke` (permission + audit + recorder). В handler выполняется live
re-check allowlist + `canUseMcpServer` (data boundary). Прямого пути исполнения нет.

## Безопасность

- Endpoint MCP-сервера — только `endpoint_secret_ref` (напр. `env:MCP_FILES_URL`),
  резолв через `SecretResolver`. Сырой endpoint/секрет/токен не принимается, не
  возвращается в DTO и не логируется (`REDACT_PATHS`).
- Health-check `detail` — только безопасное краткое описание.
- Audit на каждое мутирующее действие (`mcp.server.*`, `mcp.tool.*`) с безопасными meta.

## Эксплуатация (v1)

- **MCP-клиент — stub** (`InMemoryMcpClient`): без сетевых вызовов. Реальный HTTP/stdio
  MCP-клиент (JSON-RPC `tools/list`, `ping`, вызов tool) — отдельный этап развёртывания.
- **Single-process sync**: enable/disable отражается в ToolRegistry только текущего
  процесса. Для multi-process развёртывания изменения подхватываются при рестарте
  (startup-sync из БД). Multi-process invalidation без рестарта — вне v1.
- **Валидация I/O**: в v1 схемы MCP-tool — passthrough (`z.unknown()`); строгая
  Zod-схема из MCP JSON Schema — follow-up.

## Миграция

`packages/db/drizzle/0007_mcp_registry.sql` (additive): `mcp_servers` (+snapshot колонки)
и таблица `mcp_server_health_checks`. Применяется отдельным deploy-шагом
(`MIGRATION_DATABASE_URL`), не из app/worker-контейнера.
