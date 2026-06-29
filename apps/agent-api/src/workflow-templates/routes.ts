/**
 * Workflow Templates API (этап 11). Регистрируется ВНУТРИ authed-scope, поэтому
 * `req.auth` гарантирован. Доступ — владелец + admin (чужой/несуществующий → 404).
 * Persistence — через `WorkflowTemplateRepo`. На create/save_draft/publish/test_run
 * пишется audit (только ids/счётчики, без содержимого определения).
 *
 * Правило валидации: draft пермиссивен (только zod-форма на границе DTO); publish и
 * test-run прогоняют граф + доступность инструментов (`validateTemplateForRun`).
 * Visual Builder сам workflow НЕ исполняет — здесь только сохранение и запуск через
 * backend (test-run делегирует в Temporal-порт; см. M3).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { ConflictError, NotFoundError } from '@su10/errors';
import type { AgentTaskRepo, WorkflowTemplateRepo } from '@su10/db';
import type { ToolRegistry } from '@su10/tools';
import type { TemporalPort } from '@su10/workflow-engine';
import { WORKFLOW_TEMPLATE_ACTIONS, AGENT_TASK_ACTIONS } from '../audit/auditActions.js';
import { TaskCardSchema, toTaskCard } from '../agent-tasks/dto.js';
import { canViewTemplate, canEditTemplate } from './access.js';
import {
  CreateTemplateBody,
  ListTemplatesQuery,
  ListTemplatesResponse,
  SaveDraftBody,
  TemplateCardSchema,
  TemplateIdParams,
  TestRunBody,
  toTemplateCard,
  toTemplateSummary,
} from './dto.js';
import { validateTemplateForRun } from './validation.js';

export interface WorkflowTemplatesDeps {
  templateRepo: WorkflowTemplateRepo;
  taskRepo: AgentTaskRepo;
  temporal: TemporalPort;
  auditSink: AuditSink;
  toolRegistry: ToolRegistry;
  taskQueue: string;
}

function authOf(req: FastifyRequest): { sub: string; roles: string[] } {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('workflow template not found');
  return { sub: auth.sub, roles: auth.roles };
}

const nowIso = (): string => new Date().toISOString();

function emptyDefinition(name: string): unknown {
  return { id: 'draft', name, version: 1, nodes: [], edges: [] };
}

export const workflowTemplatesRoutes: FastifyPluginAsync<WorkflowTemplatesDeps> = async (
  root,
  deps,
) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { templateRepo, taskRepo, temporal, auditSink, toolRegistry, taskQueue } = deps;

  // GET /workflow-templates — список (scope владелец + admin).
  app.get(
    '/workflow-templates',
    {
      schema: {
        tags: ['workflow-templates'],
        summary: 'Список шаблонов (владелец + admin)',
        querystring: ListTemplatesQuery,
        response: { 200: ListTemplatesResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const { status, limit, cursor } = req.query;
      const res = await templateRepo.listTemplates({
        requesterId: auth.sub,
        isAdmin: auth.roles.includes('admin'),
        ...(status ? { status } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        items: res.items.map(toTemplateSummary),
        ...(res.nextCursor ? { nextCursor: res.nextCursor } : {}),
      };
    },
  );

  // POST /workflow-templates — создать шаблон (draft v1).
  app.post(
    '/workflow-templates',
    {
      schema: {
        tags: ['workflow-templates'],
        summary: 'Создать шаблон',
        body: CreateTemplateBody,
        response: { 201: TemplateCardSchema },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const body = req.body;
      const { template, version } = await templateRepo.createTemplate({
        createdBy: auth.sub,
        name: body.name,
        description: body.description ?? null,
        definition: body.definition ?? emptyDefinition(body.name),
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: WORKFLOW_TEMPLATE_ACTIONS.create,
        resource: `workflow_template:${template.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { templateId: template.id, key: template.key },
      });
      return reply.code(201).send(toTemplateCard(template, version));
    },
  );

  // GET /workflow-templates/:id — карточка + определение текущей версии.
  app.get(
    '/workflow-templates/:id',
    {
      schema: {
        tags: ['workflow-templates'],
        summary: 'Карточка шаблона',
        params: TemplateIdParams,
        response: { 200: TemplateCardSchema },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const found = await templateRepo.getTemplateById(req.params.id);
      if (!found || !canViewTemplate(auth, found.template)) {
        throw new NotFoundError('workflow template not found');
      }
      return toTemplateCard(found.template, found.version);
    },
  );

  // PUT /workflow-templates/:id/draft — сохранить черновик (пермиссивно).
  app.put(
    '/workflow-templates/:id/draft',
    {
      schema: {
        tags: ['workflow-templates'],
        summary: 'Сохранить черновик',
        params: TemplateIdParams,
        body: SaveDraftBody,
        response: { 200: TemplateCardSchema },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const found = await templateRepo.getTemplateById(req.params.id);
      if (!found || !canEditTemplate(auth, found.template)) {
        throw new NotFoundError('workflow template not found');
      }
      const { template, version } = await templateRepo.saveDraft({
        templateId: req.params.id,
        definition: req.body.definition,
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: WORKFLOW_TEMPLATE_ACTIONS.saveDraft,
        resource: `workflow_template:${template.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: {
          templateId: template.id,
          version: version.version,
          nodes: req.body.definition.nodes.length,
          edges: req.body.definition.edges.length,
        },
      });
      return toTemplateCard(template, version);
    },
  );

  // POST /workflow-templates/:id/publish — опубликовать текущую версию.
  app.post(
    '/workflow-templates/:id/publish',
    {
      schema: {
        tags: ['workflow-templates'],
        summary: 'Опубликовать шаблон',
        params: TemplateIdParams,
        response: { 200: TemplateCardSchema },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const found = await templateRepo.getTemplateById(req.params.id);
      if (!found || !canEditTemplate(auth, found.template)) {
        throw new NotFoundError('workflow template not found');
      }
      const validation = validateTemplateForRun(found.version.definitionJson, toolRegistry);
      if (!validation.ok) {
        throw new ConflictError('workflow template definition is invalid', {
          issues: validation.issues,
        });
      }
      const { template, version } = await templateRepo.publish({ templateId: req.params.id });
      await audit(auditSink, {
        actor: auth.sub,
        action: WORKFLOW_TEMPLATE_ACTIONS.publish,
        resource: `workflow_template:${template.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { templateId: template.id, version: version.version },
      });
      return toTemplateCard(template, version);
    },
  );

  // POST /workflow-templates/:id/test-run — прогон текущей версии (M3).
  app.post(
    '/workflow-templates/:id/test-run',
    {
      schema: {
        tags: ['workflow-templates'],
        summary: 'Тестовый прогон шаблона',
        params: TemplateIdParams,
        body: TestRunBody,
        response: { 201: TaskCardSchema },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const found = await templateRepo.getTemplateById(req.params.id);
      if (!found || !canEditTemplate(auth, found.template)) {
        throw new NotFoundError('workflow template not found');
      }
      const validation = validateTemplateForRun(found.version.definitionJson, toolRegistry);
      if (!validation.ok || !validation.template) {
        throw new ConflictError('workflow template definition is invalid', {
          issues: validation.issues,
        });
      }
      const task = await taskRepo.createTask({
        createdBy: auth.sub,
        title: found.template.name,
        taskType: 'visual_template',
        templateId: found.template.id,
        templateVersionId: found.version.id,
        sourcePortal: req.ctx.sourcePortal ?? null,
        inputJson: req.body.inputJson ?? null,
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: AGENT_TASK_ACTIONS.create,
        resource: `agent_task:${task.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { taskId: task.id, templateId: found.template.id, version: found.version.version },
      });
      const run = await templateRepo.recordRun({
        templateId: found.template.id,
        templateVersionId: found.version.id,
        taskId: task.id,
      });

      try {
        const { workflowId } = await temporal.startAgentTaskWorkflow({
          taskId: task.id,
          templateId: found.template.id,
          template: validation.template,
          taskQueue,
          subject: { id: auth.sub, roles: auth.roles },
        });
        const queued = await taskRepo.transitionStatus({
          taskId: task.id,
          to: 'queued',
          eventType: 'started',
          workflowId,
        });
        await templateRepo.updateRunStatus({
          runId: run.id,
          status: 'started',
          workflowId,
          startedAt: new Date(),
        });
        await audit(auditSink, {
          actor: auth.sub,
          action: WORKFLOW_TEMPLATE_ACTIONS.testRun,
          resource: `workflow_template:${found.template.id}`,
          outcome: 'success',
          at: nowIso(),
          meta: { templateId: found.template.id, taskId: task.id, workflowId, runId: run.id },
        });
        return reply.code(201).send(toTaskCard(queued));
      } catch (err) {
        req.log.error({ err }, 'visual template workflow start failed');
        const failed = await taskRepo.transitionStatus({
          taskId: task.id,
          to: 'failed',
          eventType: 'failed',
          message: 'workflow start failed',
          errorCode: 'TEMPORAL_START_FAILED',
        });
        await templateRepo.updateRunStatus({
          runId: run.id,
          status: 'failed',
          errorCode: 'TEMPORAL_START_FAILED',
        });
        await audit(auditSink, {
          actor: auth.sub,
          action: WORKFLOW_TEMPLATE_ACTIONS.testRun,
          resource: `workflow_template:${found.template.id}`,
          outcome: 'failure',
          at: nowIso(),
          meta: { templateId: found.template.id, taskId: task.id, errorCode: 'TEMPORAL_START_FAILED' },
        });
        return reply.code(201).send(toTaskCard(failed));
      }
    },
  );
};
