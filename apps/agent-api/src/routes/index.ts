/**
 * Route registration skeleton. Each of the 10 domain groups is a Fastify plugin
 * mounted under the API prefix (e.g. /api/v1/agent/tasks). At the foundation
 * stage every group exposes a single representative 501 stub — proving the
 * structure, auth and error-envelope end to end — which later stages replace
 * with real endpoints. Registered INSIDE the authenticated scope.
 */
import type { FastifyPluginAsync } from 'fastify';
import { NotImplementedError } from '@su10/errors';
import { agentTasksRoutes, type AgentTasksDeps } from '../agent-tasks/routes.js';
import { toolsRoutes, type ToolsRoutesDeps } from './tools.js';
import { documentsRoutes, type DocumentsDeps } from '../documents/routes.js';
import { ragRoutes, type RagDeps } from '../rag/routes.js';
import { llmAdminRoutes, type LlmAdminDeps } from '../llm/routes.js';
import { connectorsRoutes, type ConnectorsDeps } from '../connectors/routes.js';
import {
  workflowTemplatesRoutes,
  type WorkflowTemplatesDeps,
} from '../workflow-templates/routes.js';

export interface RouteGroup {
  prefix: string;
  tag: string;
}

/** Зависимости реальных групп роутов (инжектируются из server.ts через buildApp). */
export type RouteDeps = AgentTasksDeps &
  ToolsRoutesDeps & {
    /** Documents API — registered only when documents/S3 are configured. */
    documents?: DocumentsDeps;
    /** RAG API — registered only when the RAG service is wired. */
    rag?: RagDeps;
    /** LLM admin API — registered only when the provider registry is wired. */
    llmAdmin?: LlmAdminDeps;
    /** Connectors API — registered only when the mail connector is enabled. */
    connectors?: ConnectorsDeps;
    /** Workflow Templates API — registered only when the template repo is wired. */
    workflowTemplates?: WorkflowTemplatesDeps;
  };

const BASE_IMPLEMENTED_PREFIXES = ['/agent/tasks', '/tools'] as const;

export const ROUTE_GROUPS: readonly RouteGroup[] = [
  { prefix: '/agent/tasks', tag: 'agent-tasks' },
  { prefix: '/agent/chat', tag: 'agent-chat' },
  { prefix: '/workflow-templates', tag: 'workflow-templates' },
  { prefix: '/documents', tag: 'documents' },
  { prefix: '/rag', tag: 'rag' },
  { prefix: '/tools', tag: 'tools' },
  { prefix: '/mcp', tag: 'mcp' },
  { prefix: '/connectors', tag: 'connectors' },
  { prefix: '/approvals', tag: 'approvals' },
  { prefix: '/artifacts', tag: 'artifacts' },
  { prefix: '/audit', tag: 'audit' },
];

export const routes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  const implemented = new Set<string>(BASE_IMPLEMENTED_PREFIXES);

  // Реализованные группы: AgentTask lifecycle (этап 4) + Tool Registry (этап 5).
  await app.register(agentTasksRoutes, deps);
  await app.register(toolsRoutes, deps);

  // Documents API (этап 9 / M2) — только если сконфигурированы S3/документы.
  if (deps.documents) {
    await app.register(documentsRoutes, deps.documents);
    implemented.add('/documents');
  }

  // RAG API (этап 9 / M4) — только если сконфигурирован RAG-сервис.
  if (deps.rag) {
    await app.register(ragRoutes, deps.rag);
    implemented.add('/rag');
  }

  // LLM admin API (этап 8 / M7) — только если сконфигурирован реестр провайдеров.
  if (deps.llmAdmin) {
    await app.register(llmAdminRoutes, deps.llmAdmin);
  }

  // Connectors API (шаг 10) — только при включённом mail connector.
  if (deps.connectors) {
    await app.register(connectorsRoutes, deps.connectors);
    implemented.add('/connectors');
  }

  // Workflow Templates API (этап 11) — только если подключён templateRepo.
  if (deps.workflowTemplates) {
    await app.register(workflowTemplatesRoutes, deps.workflowTemplates);
    implemented.add('/workflow-templates');
  }

  // Остальные группы — представительные 501-заглушки (заменяются в след. этапах).
  for (const group of ROUTE_GROUPS) {
    if (implemented.has(group.prefix)) continue;
    await app.register(async (g) => {
      g.get(
        group.prefix,
        { schema: { tags: [group.tag], summary: `${group.tag}: not implemented yet` } },
        async () => {
          throw new NotImplementedError(`${group.tag} is not implemented yet`);
        },
      );
    });
  }
};
