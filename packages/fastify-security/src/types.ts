/** Shared option types + Fastify request augmentation for the security layer. */
import type { AuthContext } from '@su10/oidc';
import type { RequestContext } from '@su10/logger';

declare module 'fastify' {
  interface FastifyRequest {
    /** Per-request context (requestId, correlationId, sourcePortal, sub). */
    ctx: RequestContext;
    /** Verified caller — present only inside authenticated scopes. */
    auth?: AuthContext;
  }
}

export interface SecurityOptions {
  /** CORS allowlist; `false` disables cross-origin (same-origin only). */
  corsOrigins?: string[] | false;
  rateLimit?: { max?: number; timeWindow?: string };
  /** Portals accepted from the (client-controlled) X-Source-Portal header. */
  allowedSourcePortals?: string[];
}
