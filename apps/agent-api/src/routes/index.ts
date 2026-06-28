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

export interface RouteGroup {
  prefix: string;
  tag: string;
}

/** Зависимости реальных групп роутов (инжектируются из server.ts через buildApp). */
export type RouteDeps = AgentTasksDeps & ToolsRoutesDeps;

const IMPLEMENTED_PREFIXES = new Set(['/agent/tasks', '/tools']);

export const ROUTE_GROUPS: readonly RouteGroup[] = [
  { prefix: '/agent/tasks', tag: 'agent-tasks' },
  { prefix: '/agent/chat', tag: 'agent-chat' },
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
  // Реализованные группы: AgentTask lifecycle (этап 4) + Tool Registry (этап 5).
  await app.register(agentTasksRoutes, deps);
  await app.register(toolsRoutes, deps);

  // Остальные группы — представительные 501-заглушки (заменяются в след. этапах).
  for (const group of ROUTE_GROUPS) {
    if (IMPLEMENTED_PREFIXES.has(group.prefix)) continue;
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
