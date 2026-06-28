/** artifact.create — создать артефакт задачи. `storageKey` — S3-ключ, НЕ URL. */
import { z } from 'zod';
import type { ToolDefinition } from '@su10/tools';
import type { BaseToolDeps } from '../ports.js';

const input = z.object({
  taskId: z.string().uuid(),
  artifactType: z.string().min(1),
  name: z.string().min(1).optional(),
  storageKey: z
    .string()
    .min(1)
    .refine((v) => !/^https?:\/\//i.test(v), 'storageKey must be an S3 object key, not a URL'),
  contentHash: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});
const output = z.object({ artifactId: z.string() });

export function artifactCreateTool(
  deps: BaseToolDeps,
): ToolDefinition<z.infer<typeof input>, z.infer<typeof output>> {
  return {
    name: 'artifact.create',
    version: 1,
    description: 'Создать артефакт задачи (ссылка на объект в S3)',
    category: 'artifact',
    riskLevel: 'medium',
    inputSchema: input,
    outputSchema: output,
    allowedRoles: ['artifacts.write'],
    timeoutMs: 5000,
    async handler(inp) {
      const row = await deps.artifactRepo.create({
        taskId: inp.taskId,
        artifactType: inp.artifactType,
        name: inp.name ?? null,
        storageKey: inp.storageKey,
        contentHash: inp.contentHash ?? null,
        sizeBytes: inp.sizeBytes ?? null,
        metadata: inp.metadata ?? null,
      });
      return { artifactId: row.id };
    },
  };
}
