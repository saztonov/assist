/** Auth/role helpers for the connectors REST surface. */
import type { FastifyRequest } from 'fastify';
import { AuthzError, NotFoundError } from '@su10/errors';

export interface ConnectorAuth {
  sub: string;
  roles: string[];
}

export function authOf(req: FastifyRequest): ConnectorAuth {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('connector not found');
  return { sub: auth.sub, roles: auth.roles };
}

/** Requires admin or the named management role (e.g. connector.mail.create). */
export function requireRole(auth: ConnectorAuth, role: string): void {
  if (auth.roles.includes('admin') || auth.roles.includes(role)) return;
  throw new AuthzError('insufficient role for connector management');
}
