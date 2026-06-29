/**
 * REST approvals (этап 12). Регистрируется ВНУТРИ authed-scope. Доступ — subject +
 * admin (чужое/несуществующее → 404). Резолв атомарен и ограничен `pending`:
 * сначала getById (404/ACL), затем guarded resolve (undefined → 409 уже решено).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { ConflictError, NotFoundError } from '@su10/errors';
import type { AgentApprovalRepo, ApprovalDecision } from '@su10/db';
import { APPROVAL_ACTIONS } from '../audit/auditActions.js';
import { canViewApproval, isAdmin } from './access.js';
import {
  ApprovalCardSchema,
  ApprovalIdParams,
  ListApprovalsQuery,
  ListApprovalsResponse,
  ResolveBody,
  toApprovalCard,
} from './dto.js';

export interface ApprovalsDeps {
  approvalRepo: AgentApprovalRepo;
  auditSink: AuditSink;
}

function authOf(req: FastifyRequest): { sub: string; roles: string[] } {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('approval not found');
  return { sub: auth.sub, roles: auth.roles };
}

const nowIso = (): string => new Date().toISOString();

export const approvalsRoutes: FastifyPluginAsync<ApprovalsDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { approvalRepo, auditSink } = deps;

  // Общий обработчик approve/reject (guarded resolve → 409 если уже решено).
  async function resolveHandler(
    req: FastifyRequest,
    id: string,
    reason: string | undefined,
    decision: ApprovalDecision,
  ) {
    const auth = authOf(req);
    const existing = await approvalRepo.getById(id);
    if (!existing || !canViewApproval(auth, existing)) throw new NotFoundError('approval not found');

    const resolved = await approvalRepo.resolve({
      approvalId: existing.id,
      decision,
      decidedBy: auth.sub,
      reason: reason ?? null,
    });
    if (!resolved) {
      throw new ConflictError('approval is not pending', { status: existing.status });
    }

    await audit(auditSink, {
      actor: auth.sub,
      action: decision === 'approved' ? APPROVAL_ACTIONS.approve : APPROVAL_ACTIONS.reject,
      resource: `approval:${resolved.id}`,
      outcome: 'success',
      at: nowIso(),
      meta: { approvalId: resolved.id, status: resolved.status },
    });
    return toApprovalCard(resolved);
  }

  // GET /approvals — список (по умолчанию pending) для subject/admin.
  app.get(
    '/approvals',
    {
      schema: {
        tags: ['approvals'],
        summary: 'Список approvals (свои + admin все)',
        querystring: ListApprovalsQuery,
        response: { 200: ListApprovalsResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const items = await approvalRepo.listForSubject({
        subjectId: auth.sub,
        isAdmin: isAdmin(auth.roles),
        status: req.query.status,
        limit: req.query.limit,
      });
      return { items: items.map(toApprovalCard) };
    },
  );

  // GET /approvals/:id — карточка approval.
  app.get(
    '/approvals/:id',
    {
      schema: {
        tags: ['approvals'],
        summary: 'Карточка approval',
        params: ApprovalIdParams,
        response: { 200: ApprovalCardSchema },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const row = await approvalRepo.getById(req.params.id);
      if (!row || !canViewApproval(auth, row)) throw new NotFoundError('approval not found');
      return toApprovalCard(row);
    },
  );

  // POST /approvals/:id/approve
  app.post(
    '/approvals/:id/approve',
    {
      schema: {
        tags: ['approvals'],
        summary: 'Подтвердить approval',
        params: ApprovalIdParams,
        body: ResolveBody,
        response: { 200: ApprovalCardSchema },
      },
    },
    async (req) => resolveHandler(req, req.params.id, req.body.reason, 'approved'),
  );

  // POST /approvals/:id/reject
  app.post(
    '/approvals/:id/reject',
    {
      schema: {
        tags: ['approvals'],
        summary: 'Отклонить approval',
        params: ApprovalIdParams,
        body: ResolveBody,
        response: { 200: ApprovalCardSchema },
      },
    },
    async (req) => resolveHandler(req, req.params.id, req.body.reason, 'rejected'),
  );
};
