/**
 * In-memory реализация `AgentTaskRepo` (НЕ фейк Drizzle, а самостоятельная
 * корректная реализация интерфейса). Используется в DB-free unit/integration
 * тестах (agent-api `app.inject`) — по образцу `InMemoryAuditSink` из `@su10/audit`.
 *
 * Семантику переходов делит с продакшен-репозиторием через `assertTransition`.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '@su10/errors';
import { assertTransition, type AgentTaskStatus } from '../domain/agentTaskStatus.js';
import {
  encodeCursor,
  decodeCursor,
  type AgentTaskRepo,
  type AgentTaskRow,
  type AgentTaskEventRow,
  type CreateTaskInput,
  type ListEventsOptions,
  type ListTasksFilter,
  type ListTasksResult,
  type TransitionInput,
} from './agentTaskRepo.js';

const EVENTS_DEFAULT_LIMIT = 200;

export class InMemoryAgentTaskRepo implements AgentTaskRepo {
  readonly tasks: AgentTaskRow[] = [];
  readonly events: AgentTaskEventRow[] = [];
  /** Монотонный счётчик — стабильный порядок (created_at) в тестах. */
  private seq = 0;

  private now(): Date {
    // База + seq мс гарантирует строгий порядок создания при сортировке.
    return new Date(Date.UTC(2026, 0, 1) + this.seq++ * 1000);
  }

  async createTask(input: CreateTaskInput): Promise<AgentTaskRow> {
    const ts = this.now();
    const row: AgentTaskRow = {
      id: randomUUID(),
      status: 'created',
      title: input.title ?? null,
      taskType: input.taskType ?? null,
      workflowId: null,
      templateId: input.templateId ?? null,
      templateVersionId: input.templateVersionId ?? null,
      createdBy: input.createdBy,
      sourcePortal: input.sourcePortal ?? null,
      departmentId: input.departmentId ?? null,
      projectId: input.projectId ?? null,
      inputJson: input.inputJson ?? null,
      resultJson: null,
      errorCode: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.tasks.push(row);
    this.appendEvent(row.id, 'created', 'created');
    return row;
  }

  async transitionStatus(input: TransitionInput): Promise<AgentTaskRow> {
    const row = this.tasks.find((t) => t.id === input.taskId);
    if (!row) throw new NotFoundError('task not found');
    if (input.expectedFrom && row.status !== input.expectedFrom) {
      throw new ConflictError('Task status changed concurrently', {
        expected: input.expectedFrom,
        actual: row.status,
      });
    }
    assertTransition(row.status as AgentTaskStatus, input.to);
    row.status = input.to;
    row.updatedAt = this.now();
    if (input.errorCode !== undefined) row.errorCode = input.errorCode;
    if (input.workflowId !== undefined) row.workflowId = input.workflowId;
    if (input.resultJson !== undefined) row.resultJson = input.resultJson;
    this.appendEvent(input.taskId, input.eventType ?? input.to, input.to, input.message, input.dataJson);
    return row;
  }

  async getTaskById(id: string): Promise<AgentTaskRow | undefined> {
    return this.tasks.find((t) => t.id === id);
  }

  async listTasks(filter: ListTasksFilter): Promise<ListTasksResult> {
    let rows = [...this.tasks];
    if (!filter.isAdmin) rows = rows.filter((t) => t.createdBy === filter.requesterId);
    if (filter.status) rows = rows.filter((t) => t.status === filter.status);
    rows.sort((a, b) => {
      const d = b.createdAt.getTime() - a.createdAt.getTime();
      return d !== 0 ? d : b.id.localeCompare(a.id);
    });
    if (filter.cursor) {
      const c = decodeCursor(filter.cursor);
      if (c) {
        rows = rows.filter(
          (t) =>
            t.createdAt.getTime() < c.createdAt.getTime() ||
            (t.createdAt.getTime() === c.createdAt.getTime() && t.id < c.id),
        );
      }
    }
    const hasMore = rows.length > filter.limit;
    const items = hasMore ? rows.slice(0, filter.limit) : rows;
    const result: ListTasksResult = { items };
    if (hasMore) result.nextCursor = encodeCursor(items[items.length - 1]);
    return result;
  }

  async listEvents(taskId: string, opts?: ListEventsOptions): Promise<AgentTaskEventRow[]> {
    const rows = this.events
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => {
        const d = a.createdAt.getTime() - b.createdAt.getTime();
        return d !== 0 ? d : a.id.localeCompare(b.id);
      })
      .slice(0, opts?.limit ?? EVENTS_DEFAULT_LIMIT);
    return rows;
  }

  private appendEvent(
    taskId: string,
    eventType: string,
    status: string | null,
    message?: string | null,
    dataJson?: unknown,
  ): void {
    this.events.push({
      id: randomUUID(),
      taskId,
      eventType,
      status,
      message: message ?? null,
      dataJson: dataJson ?? null,
      createdAt: this.now(),
    });
  }
}
