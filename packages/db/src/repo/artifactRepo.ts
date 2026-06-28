/** Доступ к agent_task_artifacts (для базового tool artifact.create). */
import { agentTaskArtifacts } from '../schema/agentTasks.js';
import type { Database } from '../index.js';

export type ArtifactRow = typeof agentTaskArtifacts.$inferSelect;

export interface CreateArtifactInput {
  taskId: string;
  artifactType: string;
  name?: string | null;
  /** S3 object key (НЕ URL). */
  storageKey?: string | null;
  contentHash?: string | null;
  sizeBytes?: number | null;
  metadata?: unknown;
}

export interface ArtifactRepo {
  create(input: CreateArtifactInput): Promise<ArtifactRow>;
}

export function createArtifactRepo(db: Database): ArtifactRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(agentTaskArtifacts)
        .values({
          taskId: input.taskId,
          artifactType: input.artifactType,
          name: input.name ?? null,
          storageKey: input.storageKey ?? null,
          contentHash: input.contentHash ?? null,
          sizeBytes: input.sizeBytes ?? null,
          metadataJson: input.metadata ?? null,
        })
        .returning();
      return row;
    },
  };
}
