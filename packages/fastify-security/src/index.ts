/**
 * Composable Fastify security layer. NODE-ONLY.
 *
 * `securityPlugin` (global): helmet, CORS allowlist, rate-limit, request-context
 * (+ ALS), and the typed error/not-found handlers — applied to ALL routes.
 * `authPlugin` (encapsulated): the Bearer/JWT auth hook, registered ONLY inside
 * the authenticated scope so public routes (health, openapi) bypass it.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { requestContextPlugin } from './request-context.js';
import { errorsPlugin } from './error-handler.js';
import type { SecurityOptions } from './types.js';

const plugin: FastifyPluginAsync<SecurityOptions> = async (app, opts) => {
  await app.register(helmet);
  await app.register(cors, { origin: opts.corsOrigins ?? false });
  await app.register(rateLimit, {
    max: opts.rateLimit?.max ?? 100,
    timeWindow: opts.rateLimit?.timeWindow ?? '1 minute',
    // Prefer per-user keying where the caller is already authenticated; the
    // global hook runs before auth so this is `ip` for unauthenticated routes.
    keyGenerator: (req) => req.auth?.sub ?? req.ip,
  });
  await app.register(requestContextPlugin, {
    ...(opts.allowedSourcePortals ? { allowedSourcePortals: opts.allowedSourcePortals } : {}),
  });
  await app.register(errorsPlugin);
};

export const securityPlugin = fp(plugin, { name: 'su10-security', fastify: '5.x' });

export { authPlugin, type AuthOptions } from './auth.js';
export { requestContextPlugin, type RequestContextOptions } from './request-context.js';
export { errorsPlugin } from './error-handler.js';
export { derivePortalFromAzp, portalFromHeader } from './source-portal.js';
export type { SecurityOptions } from './types.js';
