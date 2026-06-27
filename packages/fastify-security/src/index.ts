/** Composable Fastify security plugin: helmet, CORS, rate-limit, safe errors. NODE-ONLY. */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppError } from '@su10/errors';

export interface SecurityOptions {
  corsOrigins?: string[] | false;
  rateLimitMax?: number;
}

const plugin: FastifyPluginAsync<SecurityOptions> = async (app, opts) => {
  await app.register(helmet);
  await app.register(cors, { origin: opts.corsOrigins ?? false });
  await app.register(rateLimit, { max: opts.rateLimitMax ?? 100, timeWindow: '1 minute' });

  // Safe error responses: typed AppErrors map to their public projection;
  // everything else becomes a generic 500 with a correlation id (no leaks).
  app.setErrorHandler((err, req, reply) => {
    const correlationId = String(req.id ?? 'unknown');
    if (err instanceof AppError) {
      void reply.status(err.httpStatus).send(err.toPublic(correlationId));
      return;
    }
    req.log.error({ err }, 'unhandled error');
    void reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'Internal server error', correlationId } });
  });
};

export const securityPlugin = fp(plugin, { name: 'su10-security', fastify: '5.x' });
