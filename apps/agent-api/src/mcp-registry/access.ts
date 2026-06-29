/** Auth/role helpers для MCP registry REST. Все мутации — admin-only. */
import type { FastifyRequest } from 'fastify';
import { AuthzError, NotFoundError } from '@su10/errors';

export interface McpAuth {
  sub: string;
  roles: string[];
}

/** Роль управления MCP-реестром (admin байпасит). */
export const MCP_MANAGE_ROLE = 'mcp.manage';

export function authOf(req: FastifyRequest): McpAuth {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('mcp server not found');
  return { sub: auth.sub, roles: auth.roles };
}

/** Требует admin или роль управления MCP. */
export function requireMcpManage(auth: McpAuth): void {
  if (auth.roles.includes('admin') || auth.roles.includes(MCP_MANAGE_ROLE)) return;
  throw new AuthzError('insufficient role for MCP registry management');
}
