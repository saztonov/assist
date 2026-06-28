/**
 * AgentTask lifecycle API (этап 4). Регистрируется ВНУТРИ authed-scope, поэтому
 * `req.auth` гарантирован. Доступ — владелец + admin (чужая/несуществующая → 404).
 * Смена статуса — только через `taskRepo.transitionStatus`. На create/start/fail/
 * cancel пишется audit. Долгий процесс запускается через `TemporalPort` (stub).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { ConflictError, NotFoundError, UpstreamError } from '@su10/errors';
import { isTerminal, type AgentTaskRepo, type AgentTaskStatus } from '@su10/db';
import type { TemporalPort } from '@su10/workflow-engine';
import { AGENT_TASK_ACTIONS } from '../audit/auditActions.js';
import { canViewTask, isAdmin } from './access.js';
import {
  CreateTaskBody,
  EventsResponse,
  ListTasksQuery,
  ListTasksResponse,
  TaskCardSchema,
  TaskIdParams,
  toTaskCard,
  toTaskEvent,
  toTaskSummary,
} from './dto.js';

export interface AgentTasksDeps {
  taskRepo: AgentTaskRepo;
  temporal: TemporalPort;
  auditSink: AuditSink;
  taskQueue: string;
}

function authOf(req: FastifyRequest): { sub: string; roles: string[] } {
  const auth = req.auth;
  // В authed-scope authPlugin гарантирует req.auth; это страховка для типов.
  if (!auth) throw new NotFoundError('task not found');
  return { sub: auth.sub, roles: auth.roles };
}

const nowIso = (): string => new Date().toISOString();

export const agentTasksRoutes: FastifyPluginAsync<AgentTasksDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { taskRepo, temporal, auditSink, taskQueue } = deps;

  // POST /agent/tasks — создать задачу и запустить workflow (stub).
  app.post(
    '/agent/tasks',
    {
      schema: {
        tags: ['agent-tasks'],
        summary: 'Создать агентную задачу',
        body: CreateTaskBody,
        response: { 201: TaskCardSchema },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const body = req.body;
      const task = await taskRepo.createTask({
        createdBy: auth.sub,
        title: body.title ?? null,
        taskType: body.taskType ?? null,
        templateId: body.templateId ?? null,
        sourcePortal: req.ctx.sourcePortal ?? null,
        inputJson: body.inputJson ?? null,
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: AGENT_TASK_ACTIONS.create,
        resource: `agent_task:${task.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { taskId: task.id, status: task.status },
      });

      try {
        const { workflowId } = await temporal.startAgentTaskWorkflow({
          taskId: task.id,
          templateId: task.templateId ?? undefined,
          taskQueue,
        });
        const queued = await taskRepo.transitionStatus({
          taskId: task.id,
          to: 'queued',
          eventType: 'started',
          workflowId,
        });
        await audit(auditSink, {
          actor: auth.sub,
          action: AGENT_TASK_ACTIONS.start,
          resource: `agent_task:${task.id}`,
          outcome: 'success',
          at: nowIso(),
          meta: { taskId: task.id, status: queued.status, workflowId },
        });
        return reply.code(201).send(toTaskCard(queued));
      } catch (err) {
        req.log.error({ err }, 'temporal start failed');
        const failed = await taskRepo.transitionStatus({
          taskId: task.id,
          to: 'failed',
          eventType: 'failed',
          message: 'workflow start failed',
          errorCode: 'TEMPORAL_START_FAILED',
        });
        await audit(auditSink, {
          actor: auth.sub,
          action: AGENT_TASK_ACTIONS.fail,
          resource: `agent_task:${task.id}`,
          outcome: 'failure',
          at: nowIso(),
          meta: { taskId: task.id, status: failed.status, errorCode: 'TEMPORAL_START_FAILED' },
        });
        return reply.code(201).send(toTaskCard(failed));
      }
    },
  );

  // GET /agent/tasks — список задач пользователя (scope в SQL).
  app.get(
    '/agent/tasks',
    {
      schema: {
        tags: ['agent-tasks'],
        summary: 'Список задач (владелец + admin)',
        querystring: ListTasksQuery,
        response: { 200: ListTasksResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const { status, limit, cursor } = req.query;
      const res = await taskRepo.listTasks({
        requesterId: auth.sub,
        isAdmin: isAdmin(auth.roles),
        ...(status ? { status } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        items: res.items.map(toTaskSummary),
        ...(res.nextCursor ? { nextCursor: res.nextCursor } : {}),
      };
    },
  );

  // GET /agent/tasks/:id — карточка задачи.
  app.get(
    '/agent/tasks/:id',
    {
      schema: {
        tags: ['agent-tasks'],
        summary: 'Карточка задачи',
        params: TaskIdParams,
        response: { 200: TaskCardSchema },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const task = await taskRepo.getTaskById(req.params.id);
      if (!task || !canViewTask(auth, task)) throw new NotFoundError('task not found');
      return toTaskCard(task);
    },
  );

  // GET /agent/tasks/:id/events — события задачи.
  app.get(
    '/agent/tasks/:id/events',
    {
      schema: {
        tags: ['agent-tasks'],
        summary: 'События задачи',
        params: TaskIdParams,
        response: { 200: EventsResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const task = await taskRepo.getTaskById(req.params.id);
      if (!task || !canViewTask(auth, task)) throw new NotFoundError('task not found');
      const events = await taskRepo.listEvents(task.id);
      return { items: events.map(toTaskEvent) };
    },
  );

  // POST /agent/tasks/:id/cancel — отмена задачи.
  app.post(
    '/agent/tasks/:id/cancel',
    {
      schema: {
        tags: ['agent-tasks'],
        summary: 'Отменить задачу',
        params: TaskIdParams,
        response: { 200: TaskCardSchema },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const task = await taskRepo.getTaskById(req.params.id);
      if (!task || !canViewTask(auth, task)) throw new NotFoundError('task not found');
      if (isTerminal(task.status as AgentTaskStatus)) {
        throw new ConflictError('cannot cancel a terminal task', { status: task.status });
      }
      if (task.workflowId) {
        try {
          await temporal.signalCancel(task.workflowId);
        } catch (err) {
          req.log.error({ err }, 'temporal cancel failed');
          await audit(auditSink, {
            actor: auth.sub,
            action: AGENT_TASK_ACTIONS.cancel,
            resource: `agent_task:${task.id}`,
            outcome: 'failure',
            at: nowIso(),
            meta: { taskId: task.id, errorCode: 'TEMPORAL_CANCEL_FAILED' },
          });
          throw new UpstreamError('failed to signal workflow cancel');
        }
      }
      const cancelled = await taskRepo.transitionStatus({
        taskId: task.id,
        to: 'cancelled',
        eventType: 'cancelled',
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: AGENT_TASK_ACTIONS.cancel,
        resource: `agent_task:${task.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { taskId: task.id, status: cancelled.status },
      });
      return toTaskCard(cancelled);
    },
  );
};
