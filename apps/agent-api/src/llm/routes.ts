/**
 * LLM admin API (этап 8 / M7). Full CRUD of providers/models/policies + live
 * model analysis, health and a sandbox test. Admin-only (role `llm.admin`/`admin`).
 *
 * SECURITY: the registry stores only `*_secret_ref` — raw secrets/tokens never
 * enter the API, DB or logs. Responses expose only whether a token ref is set.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { AppError, AuthzError, NotFoundError } from '@su10/errors';
import type { ProviderRepo } from '@su10/db';
import type { LlmGatewayService } from '@su10/llm';
import { LLM_ADMIN_ACTIONS } from '../audit/auditActions.js';
import {
  HealthResponse,
  IdParams,
  MergedModelsResponse,
  ModelCreateBody,
  ModelIdParams,
  ModelResponse,
  ModelTestResponse,
  ModelUpdateBody,
  ModelsResponse,
  PoliciesResponse,
  PolicyCreateBody,
  PolicyResponse,
  PolicyUpdateBody,
  ProviderCreateBody,
  ProviderIdParams,
  ProviderResponse,
  ProviderUpdateBody,
  ProvidersResponse,
} from './dto.js';

export interface LlmAdminDeps {
  providerRepo: ProviderRepo;
  llm: Pick<LlmGatewayService, 'listModels' | 'healthCheck' | 'chatCompletion'>;
  auditSink: AuditSink;
}

function requireAdmin(req: FastifyRequest): { sub: string; roles: string[] } {
  const auth = req.auth;
  if (!auth) throw new NotFoundError('not found');
  if (!auth.roles.includes('admin') && !auth.roles.includes('llm.admin')) {
    throw new AuthzError('llm.admin role required');
  }
  return { sub: auth.sub, roles: auth.roles };
}

const nowIso = (): string => new Date().toISOString();

export const llmAdminRoutes: FastifyPluginAsync<LlmAdminDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { providerRepo, llm, auditSink } = deps;

  // ── Providers ──────────────────────────────────────────────────────────────
  app.get(
    '/llm/providers',
    { schema: { tags: ['llm'], summary: 'Список провайдеров (admin)', response: { 200: ProvidersResponse } } },
    async (req) => {
      requireAdmin(req);
      const providers = await providerRepo.listProviders();
      return { providers: providers.map(toProviderResponse) };
    },
  );

  app.post(
    '/llm/providers',
    {
      schema: {
        tags: ['llm'],
        summary: 'Зарегистрировать провайдера (secret_ref, без raw secret)',
        body: ProviderCreateBody,
        response: { 201: ProviderResponse },
      },
    },
    async (req, reply) => {
      const auth = requireAdmin(req);
      const created = await providerRepo.createProvider({
        ...req.body,
        ...(req.body.allowedRoles ? { allowedRoles: req.body.allowedRoles } : {}),
        ...(req.body.allowedDataClasses ? { allowedDataClasses: req.body.allowedDataClasses } : {}),
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: LLM_ADMIN_ACTIONS.providerCreate,
        resource: `llm_provider:${created.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { providerId: created.id, providerType: created.providerType },
      });
      return reply.code(201).send(toProviderResponse(created));
    },
  );

  app.patch(
    '/llm/providers/:id',
    {
      schema: {
        tags: ['llm'],
        summary: 'Обновить провайдера (admin)',
        params: ProviderIdParams,
        body: ProviderUpdateBody,
        response: { 200: ProviderResponse },
      },
    },
    async (req) => {
      const auth = requireAdmin(req);
      const row = await providerRepo.updateProvider(req.params.id, req.body);
      if (!row) throw new NotFoundError('provider not found');
      await audit(auditSink, {
        actor: auth.sub,
        action: LLM_ADMIN_ACTIONS.providerUpdate,
        resource: `llm_provider:${row.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { providerId: row.id },
      });
      return toProviderResponse(row);
    },
  );

  // ── Models ───────────────────────────────────────────────────────────────────
  app.get(
    '/llm/providers/:id/models',
    {
      schema: {
        tags: ['llm'],
        summary: 'Модели провайдера (admin)',
        params: ProviderIdParams,
        response: { 200: ModelsResponse },
      },
    },
    async (req) => {
      requireAdmin(req);
      const models = await providerRepo.listModels(req.params.id);
      return { models: models.map(toModelResponse) };
    },
  );

  app.post(
    '/llm/providers/:id/models',
    {
      schema: {
        tags: ['llm'],
        summary: 'Добавить модель провайдеру (admin)',
        params: ProviderIdParams,
        body: ModelCreateBody,
        response: { 201: ModelResponse },
      },
    },
    async (req, reply) => {
      const auth = requireAdmin(req);
      const provider = await providerRepo.getProvider(req.params.id);
      if (!provider) throw new NotFoundError('provider not found');
      const created = await providerRepo.createModel({ providerId: req.params.id, ...req.body });
      await audit(auditSink, {
        actor: auth.sub,
        action: LLM_ADMIN_ACTIONS.modelCreate,
        resource: `llm_model:${created.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { modelId: created.modelId, providerId: req.params.id },
      });
      return reply.code(201).send(toModelResponse(created));
    },
  );

  app.patch(
    '/llm/models/:id',
    {
      schema: {
        tags: ['llm'],
        summary: 'Обновить модель (admin)',
        params: IdParams,
        body: ModelUpdateBody,
        response: { 200: ModelResponse },
      },
    },
    async (req) => {
      const auth = requireAdmin(req);
      const row = await providerRepo.updateModel(req.params.id, req.body);
      if (!row) throw new NotFoundError('model not found');
      await audit(auditSink, {
        actor: auth.sub,
        action: LLM_ADMIN_ACTIONS.modelUpdate,
        resource: `llm_model:${row.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { modelId: row.modelId },
      });
      return toModelResponse(row);
    },
  );

  // GET /llm/models — merged view: registered vs live-available + analysis fields.
  app.get(
    '/llm/models',
    { schema: { tags: ['llm'], summary: 'Анализ моделей: реестр + live (admin)', response: { 200: MergedModelsResponse } } },
    async (req) => {
      requireAdmin(req);
      const registered = await providerRepo.listModels();
      let available: string[] = [];
      try {
        available = (await llm.listModels()).map((m) => m.id);
      } catch {
        available = [];
      }
      const availableSet = new Set(available);
      const byId = new Map<string, { modelId: string; purpose: string | null; contextWindow: number | null; maxParallelRequests: number | null; registered: boolean; available: boolean }>();
      for (const m of registered) {
        byId.set(m.modelId, {
          modelId: m.modelId,
          purpose: m.purpose ?? null,
          contextWindow: m.contextWindow ?? null,
          maxParallelRequests: m.maxParallelRequests ?? null,
          registered: true,
          available: availableSet.has(m.modelId),
        });
      }
      for (const id of available) {
        if (!byId.has(id)) {
          byId.set(id, { modelId: id, purpose: null, contextWindow: null, maxParallelRequests: null, registered: false, available: true });
        }
      }
      return { models: [...byId.values()] };
    },
  );

  app.post(
    '/llm/models/:modelId/test',
    {
      schema: {
        tags: ['llm'],
        summary: 'Тестовый вызов модели (admin, dry-run)',
        params: ModelIdParams,
        response: { 200: ModelTestResponse },
      },
    },
    async (req) => {
      const auth = requireAdmin(req);
      let result: { ok: boolean; model?: string; errorCode?: string };
      try {
        const res = await llm.chatCompletion({
          model: req.params.modelId,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 16,
          noThink: true,
        });
        result = { ok: true, model: res.model };
      } catch (err) {
        result = { ok: false, errorCode: err instanceof AppError ? err.code : 'LLM_TEST_FAILED' };
      }
      await audit(auditSink, {
        actor: auth.sub,
        action: LLM_ADMIN_ACTIONS.modelTest,
        resource: `llm_model:${req.params.modelId}`,
        outcome: result.ok ? 'success' : 'failure',
        at: nowIso(),
        meta: { modelId: req.params.modelId, ok: result.ok },
      });
      return result;
    },
  );

  // ── Health ───────────────────────────────────────────────────────────────────
  app.get(
    '/llm/health',
    { schema: { tags: ['llm'], summary: 'Health провайдера LM Studio (admin)', response: { 200: HealthResponse } } },
    async (req) => {
      requireAdmin(req);
      const h = await llm.healthCheck();
      return { status: h.status, models: h.models ?? [], ...(h.errorCode ? { errorCode: h.errorCode } : {}) };
    },
  );

  // ── Policies ──────────────────────────────────────────────────────────────────
  app.get(
    '/llm/policies',
    { schema: { tags: ['llm'], summary: 'Политики роутинга/данных (admin)', response: { 200: PoliciesResponse } } },
    async (req) => {
      requireAdmin(req);
      const policies = await providerRepo.listPolicies();
      return { policies: policies.map(toPolicyResponse) };
    },
  );

  app.post(
    '/llm/policies',
    {
      schema: {
        tags: ['llm'],
        summary: 'Создать политику (admin)',
        body: PolicyCreateBody,
        response: { 201: PolicyResponse },
      },
    },
    async (req, reply) => {
      const auth = requireAdmin(req);
      const created = await providerRepo.createPolicy(req.body);
      await audit(auditSink, {
        actor: auth.sub,
        action: LLM_ADMIN_ACTIONS.policyCreate,
        resource: `llm_policy:${created.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { policyId: created.id },
      });
      return reply.code(201).send(toPolicyResponse(created));
    },
  );

  app.patch(
    '/llm/policies/:id',
    {
      schema: {
        tags: ['llm'],
        summary: 'Обновить политику (admin)',
        params: IdParams,
        body: PolicyUpdateBody,
        response: { 200: PolicyResponse },
      },
    },
    async (req) => {
      const auth = requireAdmin(req);
      const row = await providerRepo.updatePolicy(req.params.id, req.body);
      if (!row) throw new NotFoundError('policy not found');
      await audit(auditSink, {
        actor: auth.sub,
        action: LLM_ADMIN_ACTIONS.policyUpdate,
        resource: `llm_policy:${row.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { policyId: row.id },
      });
      return toPolicyResponse(row);
    },
  );
};

// ── Safe projections (no secrets) ────────────────────────────────────────────

function toProviderResponse(p: {
  id: string;
  providerType: string;
  displayName: string;
  enabled: boolean;
  localOnly: boolean;
  cloudAllowed: boolean;
  apiTokenSecretRef: string | null;
}): {
  id: string;
  providerType: string;
  displayName: string;
  enabled: boolean;
  localOnly: boolean;
  cloudAllowed: boolean;
  hasToken: boolean;
} {
  return {
    id: p.id,
    providerType: p.providerType,
    displayName: p.displayName,
    enabled: p.enabled,
    localOnly: p.localOnly,
    cloudAllowed: p.cloudAllowed,
    hasToken: Boolean(p.apiTokenSecretRef),
  };
}

function toModelResponse(m: {
  id: string;
  providerId: string;
  modelId: string;
  purpose: string | null;
  contextWindow: number | null;
  maxParallelRequests: number | null;
}): {
  id: string;
  providerId: string;
  modelId: string;
  purpose: string | null;
  contextWindow: number | null;
  maxParallelRequests: number | null;
} {
  return {
    id: m.id,
    providerId: m.providerId,
    modelId: m.modelId,
    purpose: m.purpose ?? null,
    contextWindow: m.contextWindow ?? null,
    maxParallelRequests: m.maxParallelRequests ?? null,
  };
}

function toPolicyResponse(p: {
  id: string;
  name: string;
  dataClass: string;
  decision: string;
  enabled: boolean;
  priority: number;
}): { id: string; name: string; dataClass: string; decision: string; enabled: boolean; priority: number } {
  return { id: p.id, name: p.name, dataClass: p.dataClass, decision: p.decision, enabled: p.enabled, priority: p.priority };
}
