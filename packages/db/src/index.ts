/**
 * Весь доступ к PostgreSQL идёт через Drizzle ORM здесь. NODE-ONLY.
 *
 * Источники истины:
 * - Drizzle-схема (`src/schema/*`) — для PUBLIC app-таблиц;
 * - SQL-миграции (`drizzle/*.sql`) — для возможностей, которые Drizzle не покрывает
 *   (схема `rag`, pgvector, FTS/generated columns, HNSW, trigram, CHECK/UNIQUE).
 *
 * `agent_tasks` (+ Temporal `workflow_id`) — источник истины бизнес-статуса задачи.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as agentTasksMod from './schema/agentTasks.js';
import * as chatMod from './schema/chat.js';
import * as workflowMod from './schema/workflow.js';
import * as approvalsMod from './schema/approvals.js';
import * as agentRunsMod from './schema/agentRuns.js';
import * as documentsMod from './schema/documents.js';
import * as providersMod from './schema/providers.js';
import * as toolsMod from './schema/tools.js';
import * as mcpMod from './schema/mcp.js';
import * as connectorsMod from './schema/connectors.js';
import * as ragAppMod from './schema/ragApp.js';
import * as platformMod from './schema/platform.js';

// Реэкспорт таблиц/типов для типобезопасных запросов из app-кода.
export * from './schema/agentTasks.js';
export * from './schema/chat.js';
export * from './schema/workflow.js';
export * from './schema/approvals.js';
export * from './schema/agentRuns.js';
export * from './schema/documents.js';
export * from './schema/providers.js';
export * from './schema/tools.js';
export * from './schema/mcp.js';
export * from './schema/connectors.js';
export * from './schema/ragApp.js';
export * from './schema/platform.js';
// Изолированная схема `rag` (тонкое зеркало; канон — SQL). НЕ входит в `schema`.
export * from './schema/rag.js';

// Контракты провайдеров/политик и seed без секретов.
export * from './contracts/providers.js';
export * from './contracts/seed.js';

// Резолвер secret_ref → значение (env/Lockbox); секреты не в БД (fail-closed).
export * from './secretResolver.js';

// Жизненный цикл AgentTask: чистый статус-автомат, репозиторий (+in-memory),
// DB-backed audit sink. Смена статуса — только через `transitionStatus`.
export * from './domain/agentTaskStatus.js';
export * from './repo/agentTaskRepo.js';
export * from './repo/agentTaskRepo.memory.js';
export * from './repo/approvalRepo.js';
export * from './repo/artifactRepo.js';
export * from './repo/outboxRepo.js';
export * from './repo/toolRepo.js';
export * from './repo/agentRunRepo.js';
export * from './repo/agentRunRepo.memory.js';
export * from './repo/documentRepo.js';
export * from './repo/ragChunkRepo.js';
export * from './repo/ragQueryRepo.js';
export * from './repo/providerRepo.js';
export * from './audit/dbAuditSink.js';
export * from './audit/llmCallSink.js';

/**
 * Реляционная карта PUBLIC-схемы для `drizzle()`. Таблицы схемы `rag` сюда НЕ
 * включаются намеренно (доступ к ним — через `ragSchema`/типизированное зеркало).
 */
export const schema = {
  ...agentTasksMod,
  ...chatMod,
  ...workflowMod,
  ...approvalsMod,
  ...agentRunsMod,
  ...documentsMod,
  ...providersMod,
  ...toolsMod,
  ...mcpMod,
  ...connectorsMod,
  ...ragAppMod,
  ...platformMod,
};

export type Database = NodePgDatabase<typeof schema>;

/** Связь Database → его pg.Pool (для graceful shutdown без зависимости от $client). */
const pools = new WeakMap<Database, pg.Pool>();

export function createDb(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  pools.set(db, pool);
  return db;
}

/** Закрывает пул соединений (graceful shutdown). */
export async function closeDb(db: Database): Promise<void> {
  await pools.get(db)?.end();
}

/**
 * Лёгкая проверка готовности БД (`SELECT 1`). Используется опциональным
 * readiness-check (не из `buildApp`; только из I/O-точки server.ts).
 */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
