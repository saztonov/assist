/**
 * Route registration skeleton. Each of the 10 domain groups is a Fastify plugin
 * mounted under the API prefix (e.g. /api/v1/agent/tasks). At the foundation
 * stage every group exposes a single representative 501 stub — proving the
 * structure, auth and error-envelope end to end — which later stages replace
 * with real endpoints. Registered INSIDE the authenticated scope.
 */
import type { FastifyPluginAsync } from 'fastify';
import { NotImplementedError } from '@su10/errors';

export interface RouteGroup {
  prefix: string;
  tag: string;
}

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

export const routes: FastifyPluginAsync = async (app) => {
  for (const group of ROUTE_GROUPS) {
    // Each group is its own (encapsulated) plugin so later stages can split it
    // into a dedicated file; the route path carries the full group prefix to
    // keep clean, trailing-slash-free OpenAPI paths.
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
