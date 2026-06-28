/**
 * Bearer/JWT authentication hook. PLAIN (encapsulated) plugin — its onRequest
 * hook applies ONLY to the scope it is registered in and that scope's children.
 * This is how public routes (health, openapi) bypass auth: they live OUTSIDE
 * this scope. Backend authorization is therefore enforced by encapsulation, not
 * by path matching.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { AuthnError } from '@su10/errors';
import { patchRequestContext } from '@su10/logger';
import type { OidcVerifier } from '@su10/oidc';
import { derivePortalFromAzp } from './source-portal.js';

export interface AuthOptions {
  oidc: OidcVerifier;
  allowedSourcePortals?: string[];
}

const BEARER = 'Bearer ';

const plugin: FastifyPluginAsync<AuthOptions> = async (app, opts) => {
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith(BEARER)) {
      throw new AuthnError('missing bearer token');
    }
    const token = header.slice(BEARER.length).trim();
    if (!token) throw new AuthnError('empty bearer token');

    // Throws AuthnError (401) on bad token, UpstreamError (502) if IdP unreachable.
    const auth = await opts.oidc.verify(token);
    req.auth = auth;

    // Refine source portal from the authoritative azp; keep header value otherwise.
    const portal = derivePortalFromAzp(auth.azp, opts.allowedSourcePortals);
    req.ctx.sub = auth.sub;
    if (portal) req.ctx.sourcePortal = portal;
    patchRequestContext({ sub: auth.sub, ...(portal ? { sourcePortal: portal } : {}) });
    req.log = req.log.child({ sub: auth.sub, ...(portal ? { sourcePortal: portal } : {}) });
  });
};

/**
 * fp-wrapped so the onRequest hook attaches to the scope it is registered in
 * (the authenticated API scope) and applies to that scope's sibling routes —
 * while still NOT bubbling up to the root app (public routes stay open).
 */
export const authPlugin = fp(plugin, { name: 'su10-auth', fastify: '5.x' });
