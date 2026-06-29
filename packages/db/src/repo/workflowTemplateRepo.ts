/**
 * Репозиторий шаблонов workflow. Весь доступ к PostgreSQL — здесь. NODE-ONLY.
 *
 * Источник истины содержимого шаблона — `workflow_template_versions.definition_json`.
 * Модель версий: `workflow_templates.status` (`draft|published`) + `latest_version_id`.
 * «Текущая версия» = последняя (max `version`). Опубликованная = текущая при
 * `status='published'`. Правка после publish форкает новую draft-версию (vN+1) и
 * возвращает шаблон в `draft`. Смена контента — только через `saveDraft`/`publish`
 * (транзакция + `SELECT … FOR UPDATE`), чтобы конкурентные правки сериализовались.
 *
 * Контрольная сумма версии — стабильный (sorted-keys) sha256 над определением;
 * сырьё/секреты в логи/audit не попадают (хранится только хэш).
 */
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { NotFoundError } from '@su10/errors';
import { workflowTemplates, workflowTemplateVersions, workflowRuns } from '../schema/workflow.js';
import type { Database } from '../index.js';
import { encodeCursor, decodeCursor } from './agentTaskRepo.js';

export type WorkflowTemplateRow = typeof workflowTemplates.$inferSelect;
export type WorkflowTemplateVersionRow = typeof workflowTemplateVersions.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;

export type WorkflowTemplateStatus = 'draft' | 'published';

export interface TemplateWithVersion {
  template: WorkflowTemplateRow;
  version: WorkflowTemplateVersionRow;
}

export interface CreateTemplateInput {
  createdBy: string;
  name: string;
  description?: string | null;
  /** WorkflowTemplate JSON (валидируется на слое API через zod). */
  definition: unknown;
}

export interface SaveDraftInput {
  templateId: string;
  definition: unknown;
}

export interface PublishInput {
  templateId: string;
}

export interface ListTemplatesFilter {
  requesterId: string;
  isAdmin: boolean;
  status?: WorkflowTemplateStatus;
  limit: number;
  cursor?: string;
}

export interface ListTemplatesResult {
  items: WorkflowTemplateRow[];
  nextCursor?: string;
}

export interface RecordRunInput {
  templateId: string;
  templateVersionId: string;
  taskId: string;
}

export interface UpdateRunStatusInput {
  runId: string;
  status: string;
  workflowId?: string | null;
  errorCode?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface WorkflowTemplateRepo {
  createTemplate(input: CreateTemplateInput): Promise<TemplateWithVersion>;
  getTemplateById(id: string): Promise<TemplateWithVersion | undefined>;
  getVersion(
    templateId: string,
    version: number,
  ): Promise<WorkflowTemplateVersionRow | undefined>;
  listTemplates(filter: ListTemplatesFilter): Promise<ListTemplatesResult>;
  saveDraft(input: SaveDraftInput): Promise<TemplateWithVersion>;
  publish(input: PublishInput): Promise<TemplateWithVersion>;
  recordRun(input: RecordRunInput): Promise<WorkflowRunRow>;
  updateRunStatus(input: UpdateRunStatusInput): Promise<WorkflowRunRow>;
}

/** Стабильный (sorted-keys) sha256 над определением шаблона (хранится только хэш). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function templateChecksum(definition: unknown): string {
  return createHash('sha256').update(stableStringify(definition)).digest('hex');
}

/** Слаг ключа из имени (unicode-буквы/цифры, дефисы); пустой → 'template'. */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > 0 ? slug.slice(0, 80) : 'template';
}

export function createWorkflowTemplateRepo(db: Database): WorkflowTemplateRepo {
  async function uniqueKey(
    tx: Pick<Database, 'select'>,
    base: string,
  ): Promise<string> {
    const existing = await tx
      .select({ key: workflowTemplates.key })
      .from(workflowTemplates);
    const taken = new Set(existing.map((r) => r.key));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  async function latestVersion(
    tx: Pick<Database, 'select'>,
    templateId: string,
  ): Promise<WorkflowTemplateVersionRow | undefined> {
    const [row] = await tx
      .select()
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.templateId, templateId))
      .orderBy(desc(workflowTemplateVersions.version))
      .limit(1);
    return row;
  }

  return {
    async createTemplate(input) {
      return db.transaction(async (tx) => {
        const key = await uniqueKey(tx, slugify(input.name));
        const [template] = await tx
          .insert(workflowTemplates)
          .values({
            key,
            name: input.name,
            description: input.description ?? null,
            status: 'draft',
            createdBy: input.createdBy,
          })
          .returning();
        const [version] = await tx
          .insert(workflowTemplateVersions)
          .values({
            templateId: template.id,
            version: 1,
            definitionJson: input.definition,
            checksum: templateChecksum(input.definition),
            createdBy: input.createdBy,
          })
          .returning();
        const [withLatest] = await tx
          .update(workflowTemplates)
          .set({ latestVersionId: version.id, updatedAt: new Date() })
          .where(eq(workflowTemplates.id, template.id))
          .returning();
        return { template: withLatest, version };
      });
    },

    async getTemplateById(id) {
      const [template] = await db
        .select()
        .from(workflowTemplates)
        .where(eq(workflowTemplates.id, id))
        .limit(1);
      if (!template) return undefined;
      const version = await latestVersion(db, id);
      if (!version) return undefined;
      return { template, version };
    },

    async getVersion(templateId, version) {
      const [row] = await db
        .select()
        .from(workflowTemplateVersions)
        .where(
          and(
            eq(workflowTemplateVersions.templateId, templateId),
            eq(workflowTemplateVersions.version, version),
          ),
        )
        .limit(1);
      return row;
    },

    async listTemplates(filter) {
      const conds: SQL[] = [];
      if (!filter.isAdmin) conds.push(eq(workflowTemplates.createdBy, filter.requesterId));
      if (filter.status) conds.push(eq(workflowTemplates.status, filter.status));
      if (filter.cursor) {
        const c = decodeCursor(filter.cursor);
        if (c) {
          conds.push(
            or(
              lt(workflowTemplates.createdAt, c.createdAt),
              and(eq(workflowTemplates.createdAt, c.createdAt), lt(workflowTemplates.id, c.id)),
            )!,
          );
        }
      }
      const rows = await db
        .select()
        .from(workflowTemplates)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(workflowTemplates.createdAt), desc(workflowTemplates.id))
        .limit(filter.limit + 1);

      const hasMore = rows.length > filter.limit;
      const items = hasMore ? rows.slice(0, filter.limit) : rows;
      const result: ListTemplatesResult = { items };
      if (hasMore) result.nextCursor = encodeCursor(items[items.length - 1]);
      return result;
    },

    async saveDraft(input) {
      return db.transaction(async (tx) => {
        const [template] = await tx
          .select()
          .from(workflowTemplates)
          .where(eq(workflowTemplates.id, input.templateId))
          .for('update');
        if (!template) throw new NotFoundError('workflow template not found');
        const current = await latestVersion(tx, input.templateId);
        const checksum = templateChecksum(input.definition);

        if (template.status === 'draft' && current) {
          // Перезаписываем текущую draft-версию.
          const [version] = await tx
            .update(workflowTemplateVersions)
            .set({ definitionJson: input.definition, checksum })
            .where(eq(workflowTemplateVersions.id, current.id))
            .returning();
          const [updated] = await tx
            .update(workflowTemplates)
            .set({ updatedAt: new Date() })
            .where(eq(workflowTemplates.id, input.templateId))
            .returning();
          return { template: updated, version };
        }

        // Опубликованный (или без версий) → форкаем новую draft-версию.
        const nextVersion = (current?.version ?? 0) + 1;
        const [version] = await tx
          .insert(workflowTemplateVersions)
          .values({
            templateId: input.templateId,
            version: nextVersion,
            definitionJson: input.definition,
            checksum,
            createdBy: template.createdBy,
          })
          .returning();
        const [updated] = await tx
          .update(workflowTemplates)
          .set({ status: 'draft', latestVersionId: version.id, updatedAt: new Date() })
          .where(eq(workflowTemplates.id, input.templateId))
          .returning();
        return { template: updated, version };
      });
    },

    async publish(input) {
      return db.transaction(async (tx) => {
        const [template] = await tx
          .select()
          .from(workflowTemplates)
          .where(eq(workflowTemplates.id, input.templateId))
          .for('update');
        if (!template) throw new NotFoundError('workflow template not found');
        const current = await latestVersion(tx, input.templateId);
        if (!current) throw new NotFoundError('workflow template has no version to publish');
        const [updated] = await tx
          .update(workflowTemplates)
          .set({ status: 'published', latestVersionId: current.id, updatedAt: new Date() })
          .where(eq(workflowTemplates.id, input.templateId))
          .returning();
        return { template: updated, version: current };
      });
    },

    async recordRun(input) {
      const [row] = await db
        .insert(workflowRuns)
        .values({
          templateId: input.templateId,
          templateVersionId: input.templateVersionId,
          taskId: input.taskId,
          status: 'pending',
        })
        .returning();
      return row;
    },

    async updateRunStatus(input) {
      const patch: Partial<typeof workflowRuns.$inferInsert> = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (input.workflowId !== undefined) patch.workflowId = input.workflowId;
      if (input.errorCode !== undefined) patch.errorCode = input.errorCode;
      if (input.startedAt !== undefined) patch.startedAt = input.startedAt;
      if (input.completedAt !== undefined) patch.completedAt = input.completedAt;
      const [row] = await db
        .update(workflowRuns)
        .set(patch)
        .where(eq(workflowRuns.id, input.runId))
        .returning();
      if (!row) throw new NotFoundError('workflow run not found');
      return row;
    },
  };
}

// ── In-memory implementation (tests) ─────────────────────────────────────────

export class InMemoryWorkflowTemplateRepo implements WorkflowTemplateRepo {
  readonly templates: WorkflowTemplateRow[] = [];
  readonly versions: WorkflowTemplateVersionRow[] = [];
  readonly runs: WorkflowRunRow[] = [];
  private seq = 0;

  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1) + this.seq++ * 1000);
  }

  private uniqueKey(base: string): string {
    const taken = new Set(this.templates.map((t) => t.key));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private latest(templateId: string): WorkflowTemplateVersionRow | undefined {
    return [...this.versions]
      .filter((v) => v.templateId === templateId)
      .sort((a, b) => b.version - a.version)[0];
  }

  async createTemplate(input: CreateTemplateInput): Promise<TemplateWithVersion> {
    const ts = this.now();
    const template: WorkflowTemplateRow = {
      id: randomUUID(),
      key: this.uniqueKey(slugify(input.name)),
      name: input.name,
      description: input.description ?? null,
      status: 'draft',
      latestVersionId: null,
      createdBy: input.createdBy,
      createdAt: ts,
      updatedAt: ts,
    };
    this.templates.push(template);
    const version: WorkflowTemplateVersionRow = {
      id: randomUUID(),
      templateId: template.id,
      version: 1,
      definitionJson: input.definition,
      checksum: templateChecksum(input.definition),
      createdBy: input.createdBy,
      createdAt: ts,
    };
    this.versions.push(version);
    template.latestVersionId = version.id;
    template.updatedAt = this.now();
    return { template, version };
  }

  async getTemplateById(id: string): Promise<TemplateWithVersion | undefined> {
    const template = this.templates.find((t) => t.id === id);
    if (!template) return undefined;
    const version = this.latest(id);
    if (!version) return undefined;
    return { template, version };
  }

  async getVersion(
    templateId: string,
    version: number,
  ): Promise<WorkflowTemplateVersionRow | undefined> {
    return this.versions.find((v) => v.templateId === templateId && v.version === version);
  }

  async listTemplates(filter: ListTemplatesFilter): Promise<ListTemplatesResult> {
    const rows = [...this.templates]
      .filter((t) => (filter.isAdmin ? true : t.createdBy === filter.requesterId))
      .filter((t) => (filter.status ? t.status === filter.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const items = rows.slice(0, filter.limit);
    const result: ListTemplatesResult = { items };
    if (rows.length > filter.limit) {
      const last = items[items.length - 1];
      result.nextCursor = `${last.createdAt.toISOString()}|${last.id}`;
    }
    return result;
  }

  async saveDraft(input: SaveDraftInput): Promise<TemplateWithVersion> {
    const template = this.templates.find((t) => t.id === input.templateId);
    if (!template) throw new NotFoundError('workflow template not found');
    const current = this.latest(input.templateId);
    const checksum = templateChecksum(input.definition);

    if (template.status === 'draft' && current) {
      current.definitionJson = input.definition;
      current.checksum = checksum;
      template.updatedAt = this.now();
      return { template, version: current };
    }

    const version: WorkflowTemplateVersionRow = {
      id: randomUUID(),
      templateId: input.templateId,
      version: (current?.version ?? 0) + 1,
      definitionJson: input.definition,
      checksum,
      createdBy: template.createdBy,
      createdAt: this.now(),
    };
    this.versions.push(version);
    template.status = 'draft';
    template.latestVersionId = version.id;
    template.updatedAt = this.now();
    return { template, version };
  }

  async publish(input: PublishInput): Promise<TemplateWithVersion> {
    const template = this.templates.find((t) => t.id === input.templateId);
    if (!template) throw new NotFoundError('workflow template not found');
    const current = this.latest(input.templateId);
    if (!current) throw new NotFoundError('workflow template has no version to publish');
    template.status = 'published';
    template.latestVersionId = current.id;
    template.updatedAt = this.now();
    return { template, version: current };
  }

  async recordRun(input: RecordRunInput): Promise<WorkflowRunRow> {
    const ts = this.now();
    const run: WorkflowRunRow = {
      id: randomUUID(),
      templateId: input.templateId,
      templateVersionId: input.templateVersionId,
      taskId: input.taskId,
      workflowId: null,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      errorCode: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.runs.push(run);
    return run;
  }

  async updateRunStatus(input: UpdateRunStatusInput): Promise<WorkflowRunRow> {
    const run = this.runs.find((r) => r.id === input.runId);
    if (!run) throw new NotFoundError('workflow run not found');
    run.status = input.status;
    if (input.workflowId !== undefined) run.workflowId = input.workflowId;
    if (input.errorCode !== undefined) run.errorCode = input.errorCode;
    if (input.startedAt !== undefined) run.startedAt = input.startedAt;
    if (input.completedAt !== undefined) run.completedAt = input.completedAt;
    run.updatedAt = this.now();
    return run;
  }
}
