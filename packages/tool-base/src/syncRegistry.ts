/**
 * Идемпотентная синхронизация реестра инструментов в БД (через `@su10/db` toolRepo):
 * метаданные/версии/checksum. Handler'ы в БД не хранятся. Возвращает карту
 * name → {toolId, toolVersionId} для линковки tool_call_logs. Опционально (MAY).
 */
import { createToolRepo, type Database, type ToolRef } from '@su10/db';
import type { ToolRegistry } from '@su10/tools';

export async function syncRegistryToDb(
  registry: ToolRegistry,
  db: Database,
  createdBy = 'system',
): Promise<Map<string, ToolRef>> {
  const repo = createToolRepo(db);
  const map = new Map<string, ToolRef>();
  for (const meta of registry.listMetadata()) {
    const ref = await repo.upsertToolVersion({
      name: meta.name,
      description: meta.description,
      riskLevel: meta.riskLevel,
      version: meta.version,
      inputSchema: meta.inputSchema,
      outputSchema: meta.outputSchema,
      checksum: meta.checksum,
      createdBy,
    });
    map.set(meta.name, ref);
  }
  return map;
}
