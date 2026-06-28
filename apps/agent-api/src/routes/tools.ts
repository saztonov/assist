/**
 * Tool Registry API (этап 5). Внутри authed-scope.
 *  - GET /tools — метаданные (без handler), отфильтрованы по видимости вызывающего.
 *  - GET /tools/:name — одна запись (404, если неизвестен/не виден).
 *  - POST /tools/:name/test — admin-only sandbox-харнесс (без реальных сайд-эффектов).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { InMemoryAuditSink } from '@su10/audit';
import { AppError, AuthzError, ConflictError, NotFoundError } from '@su10/errors';
import { can } from '@su10/permissions';
import type { ToolBroker, ToolMetadata, ToolRegistry } from '@su10/tools';

export interface ToolsRoutesDeps {
  toolRegistry: ToolRegistry;
  /** Sandbox-брокер (in-memory deps) для admin test harness — без реальных эффектов. */
  toolTestBroker: ToolBroker;
}

interface Subject {
  id: string;
  roles: string[];
}

function authOf(req: FastifyRequest): Subject {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('not found');
  return { id: auth.sub, roles: auth.roles };
}

const isAdmin = (roles: string[]): boolean => roles.includes('admin');

/** Виден ли инструмент вызывающему (can + allowedRoles). */
function visible(meta: ToolMetadata, sub: Subject): boolean {
  if (!can(sub, meta.name).allowed) return false;
  if (meta.allowedRoles?.length && !isAdmin(sub.roles)) {
    if (!meta.allowedRoles.some((r) => sub.roles.includes(r))) return false;
  }
  return true;
}

const ToolMetadataSchema = z.object({
  name: z.string(),
  version: z.number(),
  description: z.string(),
  category: z.string(),
  riskLevel: z.string(),
  allowedRoles: z.array(z.string()).optional(),
  requiresApproval: z.boolean(),
  timeoutMs: z.number(),
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  checksum: z.string(),
});

const ToolNameParams = z.object({ name: z.string().min(1) });
const ToolTestBody = z.object({ input: z.unknown(), dryRun: z.boolean().default(true) });
const ToolTestResponse = z.object({
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z.object({ code: z.string() }).optional(),
});

export const toolsRoutes: FastifyPluginAsync<ToolsRoutesDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { toolRegistry, toolTestBroker } = deps;

  app.get(
    '/tools',
    {
      schema: {
        tags: ['tools'],
        summary: 'Список инструментов (метаданные, без handler)',
        response: { 200: z.object({ tools: z.array(ToolMetadataSchema) }) },
      },
    },
    async (req) => {
      const sub = authOf(req);
      return { tools: toolRegistry.listMetadata().filter((m) => visible(m, sub)) };
    },
  );

  app.get(
    '/tools/:name',
    {
      schema: {
        tags: ['tools'],
        summary: 'Метаданные инструмента',
        params: ToolNameParams,
        response: { 200: ToolMetadataSchema },
      },
    },
    async (req) => {
      const sub = authOf(req);
      const meta = toolRegistry.describe(req.params.name);
      if (!meta || !visible(meta, sub)) throw new NotFoundError('tool not found');
      return meta;
    },
  );

  app.post(
    '/tools/:name/test',
    {
      schema: {
        tags: ['tools'],
        summary: 'Admin test harness (sandbox, без реальных сайд-эффектов)',
        params: ToolNameParams,
        body: ToolTestBody,
        response: { 200: ToolTestResponse },
      },
    },
    async (req) => {
      const sub = authOf(req);
      if (!isAdmin(sub.roles)) throw new AuthzError('admin role required for tool test harness');
      if (req.body.dryRun === false) {
        throw new ConflictError('live tool test harness is not enabled in this stage');
      }
      if (!toolRegistry.get(req.params.name)) throw new NotFoundError('tool not found');
      try {
        const output = await toolTestBroker.invoke(req.params.name, req.body.input, {
          subject: sub,
          approved: true,
          auditSink: new InMemoryAuditSink(),
          at: new Date().toISOString(),
        });
        return { ok: true, output };
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'UPSTREAM_ERROR';
        return { ok: false, error: { code } };
      }
    },
  );
};
