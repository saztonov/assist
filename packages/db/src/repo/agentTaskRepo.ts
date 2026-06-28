/**
 * Доступ к жизненному циклу AgentTask. Весь доступ к PostgreSQL — здесь.
 *
 * `transitionStatus` — ЕДИНСТВЕННАЯ точка смены статуса: транзакция +
 * `SELECT … FOR UPDATE` + `assertTransition` (статус-автомат) + append события в
 * `agent_task_events`. Так HTTP-слой и будущий Temporal-worker (шаг 6) делят одну
 * транзакционную реализацию и не расходятся в правилах переходов.
 */
import { and, asc, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@su10/errors';
import { agentTasks, agentTaskEvents } from '../schema/agentTasks.js';
import type { Database } from '../index.js';
import { assertTransition, type AgentTaskStatus } from '../domain/agentTaskStatus.js';

export type AgentTaskRow = typeof agentTasks.$inferSelect;
export type AgentTaskEventRow = typeof agentTaskEvents.$inferSelect;

export interface CreateTaskInput {
  createdBy: string;
  title?: string | null;
  taskType?: string | null;
  templateId?: string | null;
  templateVersionId?: string | null;
  sourcePortal?: string | null;
  departmentId?: string | null;
  projectId?: string | null;
  inputJson?: unknown;
}

export interface TransitionInput {
  taskId: string;
  to: AgentTaskStatus;
  /** Тип события (по умолчанию = `to`). */
  eventType?: string;
  message?: string | null;
  dataJson?: unknown;
  errorCode?: string | null;
  workflowId?: string | null;
  resultJson?: unknown;
  /** Опциональный optimistic-guard: текущий статус должен совпасть. */
  expectedFrom?: AgentTaskStatus;
}

export interface ListTasksFilter {
  /** Кто запрашивает (для scope). */
  requesterId: string;
  isAdmin: boolean;
  status?: AgentTaskStatus;
  limit: number;
  /** Keyset-курсор (непрозрачный) из предыдущей страницы. */
  cursor?: string;
}

export interface ListTasksResult {
  items: AgentTaskRow[];
  nextCursor?: string;
}

export interface ListEventsOptions {
  limit?: number;
}

export interface AgentTaskRepo {
  createTask(input: CreateTaskInput): Promise<AgentTaskRow>;
  transitionStatus(input: TransitionInput): Promise<AgentTaskRow>;
  getTaskById(id: string): Promise<AgentTaskRow | undefined>;
  listTasks(filter: ListTasksFilter): Promise<ListTasksResult>;
  listEvents(taskId: string, opts?: ListEventsOptions): Promise<AgentTaskEventRow[]>;
}

const EVENTS_DEFAULT_LIMIT = 200;

/** Непрозрачный keyset-курсор по (created_at, id). */
export function encodeCursor(row: Pick<AgentTaskRow, 'createdAt' | 'id'>): string {
  const ts = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
  return Buffer.from(`${ts}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | undefined {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return undefined;
    const createdAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

export function createAgentTaskRepo(db: Database): AgentTaskRepo {
  return {
    async createTask(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(agentTasks)
          .values({
            status: 'created',
            createdBy: input.createdBy,
            title: input.title ?? null,
            taskType: input.taskType ?? null,
            templateId: input.templateId ?? null,
            templateVersionId: input.templateVersionId ?? null,
            sourcePortal: input.sourcePortal ?? null,
            departmentId: input.departmentId ?? null,
            projectId: input.projectId ?? null,
            inputJson: input.inputJson ?? null,
          })
          .returning();
        await tx.insert(agentTaskEvents).values({
          taskId: row.id,
          eventType: 'created',
          status: 'created',
        });
        return row;
      });
    },

    async transitionStatus(input) {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(agentTasks)
          .where(eq(agentTasks.id, input.taskId))
          .for('update');
        if (!current) throw new NotFoundError('task not found');
        if (input.expectedFrom && current.status !== input.expectedFrom) {
          throw new ConflictError('Task status changed concurrently', {
            expected: input.expectedFrom,
            actual: current.status,
          });
        }
        assertTransition(current.status as AgentTaskStatus, input.to);

        const patch: Partial<typeof agentTasks.$inferInsert> = {
          status: input.to,
          updatedAt: new Date(),
        };
        if (input.errorCode !== undefined) patch.errorCode = input.errorCode;
        if (input.workflowId !== undefined) patch.workflowId = input.workflowId;
        if (input.resultJson !== undefined) patch.resultJson = input.resultJson;

        const [updated] = await tx
          .update(agentTasks)
          .set(patch)
          .where(eq(agentTasks.id, input.taskId))
          .returning();
        await tx.insert(agentTaskEvents).values({
          taskId: input.taskId,
          eventType: input.eventType ?? input.to,
          status: input.to,
          message: input.message ?? null,
          dataJson: input.dataJson ?? null,
        });
        return updated;
      });
    },

    async getTaskById(id) {
      const [row] = await db.select().from(agentTasks).where(eq(agentTasks.id, id)).limit(1);
      return row;
    },

    async listTasks(filter) {
      const conds: SQL[] = [];
      if (!filter.isAdmin) conds.push(eq(agentTasks.createdBy, filter.requesterId));
      if (filter.status) conds.push(eq(agentTasks.status, filter.status));
      if (filter.cursor) {
        const c = decodeCursor(filter.cursor);
        if (c) {
          conds.push(
            or(
              lt(agentTasks.createdAt, c.createdAt),
              and(eq(agentTasks.createdAt, c.createdAt), lt(agentTasks.id, c.id)),
            )!,
          );
        }
      }
      const rows = await db
        .select()
        .from(agentTasks)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(agentTasks.createdAt), desc(agentTasks.id))
        .limit(filter.limit + 1);

      const hasMore = rows.length > filter.limit;
      const items = hasMore ? rows.slice(0, filter.limit) : rows;
      const result: ListTasksResult = { items };
      if (hasMore) result.nextCursor = encodeCursor(items[items.length - 1]);
      return result;
    },

    async listEvents(taskId, opts) {
      return db
        .select()
        .from(agentTaskEvents)
        .where(eq(agentTaskEvents.taskId, taskId))
        .orderBy(asc(agentTaskEvents.createdAt), asc(agentTaskEvents.id))
        .limit(opts?.limit ?? EVENTS_DEFAULT_LIMIT);
    },
  };
}
