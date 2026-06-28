/**
 * In-memory реализация `BaseToolDeps` (без БД). Используется в тестах и в
 * sandbox-режиме admin test harness (POST /tools/:name/test) — никаких реальных
 * сайд-эффектов. По образцу `InMemoryAuditSink`/`InMemoryAgentTaskRepo`.
 */
import { randomUUID } from 'node:crypto';
import {
  InMemoryAgentTaskRepo,
  type AgentApprovalRepo,
  type ApprovalRow,
  type ArtifactRepo,
  type ArtifactRow,
  type OutboxRepo,
} from '@su10/db';
import type { BaseToolDeps } from './ports.js';

export interface InMemoryBaseTools {
  deps: BaseToolDeps;
  taskRepo: InMemoryAgentTaskRepo;
  approvals: ApprovalRow[];
  artifacts: ArtifactRow[];
  outboxKeys: Set<string>;
}

export function createInMemoryBaseToolDeps(): InMemoryBaseTools {
  const taskRepo = new InMemoryAgentTaskRepo();
  const approvals: ApprovalRow[] = [];
  const artifacts: ArtifactRow[] = [];
  const outboxKeys = new Set<string>();

  const approvalRepo: AgentApprovalRepo = {
    async create(i) {
      const row: ApprovalRow = {
        id: randomUUID(),
        taskId: i.taskId ?? null,
        toolCallId: i.toolCallId ?? null,
        subjectId: i.subjectId,
        riskLevel: i.riskLevel,
        action: i.action,
        resource: i.resource ?? null,
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        reason: i.reason ?? null,
        metadataJson: i.metadata ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      approvals.push(row);
      return row;
    },
    async resolve(i) {
      const row = approvals.find((a) => a.id === i.approvalId);
      if (!row) return undefined;
      row.status = i.decision;
      row.decidedBy = i.decidedBy;
      row.decidedAt = new Date();
      row.reason = i.reason ?? null;
      return row;
    },
    async getById(id) {
      return approvals.find((a) => a.id === id);
    },
  };

  const artifactRepo: ArtifactRepo = {
    async create(i) {
      const row: ArtifactRow = {
        id: randomUUID(),
        taskId: i.taskId,
        artifactType: i.artifactType,
        name: i.name ?? null,
        storageKey: i.storageKey ?? null,
        contentHash: i.contentHash ?? null,
        sizeBytes: i.sizeBytes ?? null,
        metadataJson: i.metadata ?? null,
        createdAt: new Date(),
      };
      artifacts.push(row);
      return row;
    },
  };

  const outboxRepo: OutboxRepo = {
    async enqueue(i) {
      if (outboxKeys.has(i.dedupeKey)) return { enqueued: false };
      outboxKeys.add(i.dedupeKey);
      return { enqueued: true };
    },
  };

  return {
    deps: { taskRepo, approvalRepo, artifactRepo, outboxRepo },
    taskRepo,
    approvals,
    artifacts,
    outboxKeys,
  };
}
