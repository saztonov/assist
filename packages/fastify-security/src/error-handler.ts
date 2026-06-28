/**
 * Typed, leak-free error + not-found handlers. Every failure path funnels into
 * the same wire contract: { error: { code, message, correlationId, details? } }.
 * Internal details/stack are logged server-side only.
 */
import fp from 'fastify-plugin';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { AppError, NotFoundError, ValidationError } from '@su10/errors';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const correlationOf = (req: { ctx?: { correlationId?: string }; id: unknown }): string =>
  req.ctx?.correlationId ?? String(req.id);

const plugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err, req, reply) => {
    const correlationId = correlationOf(req);

    // 1) zod request validation (fastify-type-provider-zod) → safe 400 + issues.
    if (hasZodFastifySchemaValidationErrors(err)) {
      const details = err.validation.map((v) => ({
        path: v.params.issue.path.join('.') || '(root)',
        message: v.params.issue.message,
      }));
      const ve = new ValidationError('request validation failed', undefined, details);
      void reply.status(ve.httpStatus).send(ve.toPublic(correlationId));
      return;
    }

    // 2) Typed application errors → their public projection.
    if (err instanceof AppError) {
      void reply.status(err.httpStatus).send(err.toPublic(correlationId));
      return;
    }

    // 3) Framework 4xx (bad JSON, unsupported media type, …) — messages are safe.
    const fe = err as FastifyError;
    if (typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
      void reply.status(fe.statusCode).send({
        error: { code: fe.code ?? 'BAD_REQUEST', message: fe.message, correlationId },
      });
      return;
    }

    // 4) Everything else → generic 500, full error logged server-side only.
    req.log.error({ err }, 'unhandled error');
    void reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'Internal server error', correlationId } });
  });

  app.setNotFoundHandler((req, reply) => {
    const nf = new NotFoundError('route not found');
    void reply.status(nf.httpStatus).send(nf.toPublic(correlationOf(req)));
  });
};

export const errorsPlugin = fp(plugin, { name: 'su10-errors', fastify: '5.x' });
