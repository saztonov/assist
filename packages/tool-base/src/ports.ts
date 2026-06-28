/**
 * Узкие порты, от которых зависят базовые инструменты (closures, не ctx.ports).
 * Реальная реализация — репозитории `@su10/db`; в тестах подставляются фейки.
 */
import {
  createAgentApprovalRepo,
  createAgentTaskRepo,
  createArtifactRepo,
  createOutboxRepo,
  type AgentApprovalRepo,
  type AgentTaskRepo,
  type ArtifactRepo,
  type Database,
  type OutboxRepo,
} from '@su10/db';

export interface BaseToolDeps {
  taskRepo: Pick<AgentTaskRepo, 'getTaskById' | 'transitionStatus'>;
  approvalRepo: AgentApprovalRepo;
  artifactRepo: ArtifactRepo;
  outboxRepo: OutboxRepo;
}

/** Собирает BaseToolDeps из репозиториев @su10/db (вся работа с БД — там). */
export function createDbBaseToolDeps(db: Database): BaseToolDeps {
  return {
    taskRepo: createAgentTaskRepo(db),
    approvalRepo: createAgentApprovalRepo(db),
    artifactRepo: createArtifactRepo(db),
    outboxRepo: createOutboxRepo(db),
  };
}
