/**
 * Per-request context: requestId, correlationId, preliminary sourcePortal, and
 * a child logger binding. Establishes the AsyncLocalStorage store for the rest
 * of the request. Global (fp) — applies to public and authenticated routes.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { enterRequestContext, type RequestContext } from '@su10/logger';
import { portalFromHeader } from './source-portal.js';

export interface RequestContextOptions {
  allowedSourcePortals?: string[];
}

const headerValue = (v: string | string[] | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

const plugin: FastifyPluginAsync<RequestContextOptions> = async (app, opts) => {
  app.addHook('onRequest', async (req, reply) => {
    const requestId = String(req.id);
    const correlationId = headerValue(req.headers['x-correlation-id']) || requestId;
    const sourcePortal = portalFromHeader(
      headerValue(req.headers['x-source-portal']),
      opts.allowedSourcePortals,
    );

    const ctx: RequestContext = { requestId, correlationId };
    if (sourcePortal) ctx.sourcePortal = sourcePortal;
    req.ctx = ctx;
    enterRequestContext(ctx);

    void reply.header('x-correlation-id', correlationId);
    req.log = req.log.child({
      requestId,
      correlationId,
      ...(sourcePortal ? { sourcePortal } : {}),
    });
  });
};

export const requestContextPlugin = fp(plugin, {
  name: 'su10-request-context',
  fastify: '5.x',
});
