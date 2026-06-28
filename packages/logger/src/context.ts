/**
 * Per-request context propagation via AsyncLocalStorage. Lets `createLogger`,
 * audit and service code pick up requestId/correlationId/sub without threading
 * them through every signature. NODE-ONLY.
 *
 * The HTTP layer calls `enterRequestContext(ctx)` in an onRequest hook; because
 * Fastify processes each request in its own async context, `enterWith` keeps the
 * store for the remainder of that request.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  sub?: string;
  sourcePortal?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` bound (synchronous/awaited scope). */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Bind `ctx` for the remainder of the current async context (Fastify hook). */
export function enterRequestContext(ctx: RequestContext): void {
  storage.enterWith(ctx);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Merge fields into the active context object (e.g. add `sub` after auth). */
export function patchRequestContext(patch: Partial<RequestContext>): void {
  const cur = storage.getStore();
  if (cur) Object.assign(cur, patch);
}
