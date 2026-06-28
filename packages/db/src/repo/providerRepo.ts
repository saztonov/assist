/**
 * LLM provider/model/policy registry repository. NODE-ONLY.
 *
 * Stores ONLY metadata and `*_secret_ref` references — never raw secrets/tokens.
 * Backs the admin model-management API. The in-memory variant backs unit tests.
 */
import { eq } from 'drizzle-orm';
import {
  llmProviderRegistry,
  llmProviderModels,
  providerPolicies,
  providerHealthEvents,
} from '../schema/providers.js';
import type { Database } from '../index.js';

export type ProviderRow = typeof llmProviderRegistry.$inferSelect;
export type RegistryModelRow = typeof llmProviderModels.$inferSelect;
export type ProviderPolicyRow = typeof providerPolicies.$inferSelect;

export interface CreateProviderInput {
  providerType: string;
  displayName: string;
  enabled?: boolean;
  baseUrlSecretRef?: string | null;
  configSecretRef?: string | null;
  apiTokenSecretRef?: string | null;
  allowedDataClasses?: unknown;
  allowedRoles?: unknown;
  localOnly?: boolean;
  cloudAllowed?: boolean;
  auditLevel?: string;
}

export interface UpdateProviderInput {
  displayName?: string;
  enabled?: boolean;
  localOnly?: boolean;
  cloudAllowed?: boolean;
  apiTokenSecretRef?: string | null;
  baseUrlSecretRef?: string | null;
}

export interface CreateModelInput {
  providerId: string;
  modelId: string;
  purpose?: string | null;
  contextWindow?: number | null;
  maxParallelRequests?: number | null;
  defaultTimeoutMs?: number | null;
  defaultTemperature?: number | null;
  supportsVision?: boolean;
  supportsJsonExtraction?: boolean;
  supportsEmbeddings?: boolean;
  embeddingDim?: number | null;
  notes?: string | null;
}

export interface UpdateModelInput {
  purpose?: string | null;
  contextWindow?: number | null;
  maxParallelRequests?: number | null;
  notes?: string | null;
}

export interface CreatePolicyInput {
  name: string;
  providerType?: string | null;
  dataClass: string;
  decision: 'allow' | 'deny';
  localOnlyRequired?: boolean;
  cloudAllowed?: boolean;
  reason?: string | null;
  priority?: number;
  enabled?: boolean;
}

export interface UpdatePolicyInput {
  decision?: 'allow' | 'deny';
  enabled?: boolean;
  priority?: number;
}

export interface ProviderHealthInput {
  providerId: string;
  status: string;
  latencyMs?: number | null;
  errorCode?: string | null;
}

export interface ProviderRepo {
  listProviders(): Promise<ProviderRow[]>;
  getProvider(id: string): Promise<ProviderRow | undefined>;
  createProvider(input: CreateProviderInput): Promise<ProviderRow>;
  updateProvider(id: string, patch: UpdateProviderInput): Promise<ProviderRow | undefined>;
  listModels(providerId?: string): Promise<RegistryModelRow[]>;
  createModel(input: CreateModelInput): Promise<RegistryModelRow>;
  updateModel(id: string, patch: UpdateModelInput): Promise<RegistryModelRow | undefined>;
  listPolicies(): Promise<ProviderPolicyRow[]>;
  createPolicy(input: CreatePolicyInput): Promise<ProviderPolicyRow>;
  updatePolicy(id: string, patch: UpdatePolicyInput): Promise<ProviderPolicyRow | undefined>;
  recordHealth(input: ProviderHealthInput): Promise<void>;
}

export function createProviderRepo(db: Database): ProviderRepo {
  return {
    async listProviders() {
      return db.select().from(llmProviderRegistry);
    },
    async getProvider(id) {
      const [row] = await db.select().from(llmProviderRegistry).where(eq(llmProviderRegistry.id, id)).limit(1);
      return row;
    },
    async createProvider(input) {
      const [row] = await db
        .insert(llmProviderRegistry)
        .values({
          providerType: input.providerType,
          displayName: input.displayName,
          enabled: input.enabled ?? false,
          baseUrlSecretRef: input.baseUrlSecretRef ?? null,
          configSecretRef: input.configSecretRef ?? null,
          apiTokenSecretRef: input.apiTokenSecretRef ?? null,
          allowedDataClasses: input.allowedDataClasses ?? null,
          allowedRoles: input.allowedRoles ?? null,
          localOnly: input.localOnly ?? true,
          cloudAllowed: input.cloudAllowed ?? false,
          auditLevel: input.auditLevel ?? 'standard',
        })
        .returning();
      return row;
    },
    async updateProvider(id, patch) {
      const [row] = await db
        .update(llmProviderRegistry)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(llmProviderRegistry.id, id))
        .returning();
      return row;
    },
    async listModels(providerId) {
      if (providerId) {
        return db.select().from(llmProviderModels).where(eq(llmProviderModels.providerId, providerId));
      }
      return db.select().from(llmProviderModels);
    },
    async createModel(input) {
      const [row] = await db
        .insert(llmProviderModels)
        .values({
          providerId: input.providerId,
          modelId: input.modelId,
          purpose: input.purpose ?? null,
          contextWindow: input.contextWindow ?? null,
          maxParallelRequests: input.maxParallelRequests ?? null,
          defaultTimeoutMs: input.defaultTimeoutMs ?? null,
          defaultTemperature: input.defaultTemperature ?? null,
          supportsVision: input.supportsVision ?? false,
          supportsJsonExtraction: input.supportsJsonExtraction ?? false,
          supportsEmbeddings: input.supportsEmbeddings ?? false,
          embeddingDim: input.embeddingDim ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    },
    async updateModel(id, patch) {
      const [row] = await db
        .update(llmProviderModels)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(llmProviderModels.id, id))
        .returning();
      return row;
    },
    async listPolicies() {
      return db.select().from(providerPolicies);
    },
    async createPolicy(input) {
      const [row] = await db
        .insert(providerPolicies)
        .values({
          name: input.name,
          providerType: input.providerType ?? null,
          dataClass: input.dataClass,
          decision: input.decision,
          localOnlyRequired: input.localOnlyRequired ?? false,
          cloudAllowed: input.cloudAllowed ?? false,
          reason: input.reason ?? null,
          priority: input.priority ?? 100,
          enabled: input.enabled ?? true,
        })
        .returning();
      return row;
    },
    async updatePolicy(id, patch) {
      const [row] = await db
        .update(providerPolicies)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(providerPolicies.id, id))
        .returning();
      return row;
    },
    async recordHealth(input) {
      await db.insert(providerHealthEvents).values({
        providerId: input.providerId,
        status: input.status,
        latencyMs: input.latencyMs ?? null,
        errorCode: input.errorCode ?? null,
      });
    },
  };
}

// ── In-memory implementation (tests) ─────────────────────────────────────────

let memSeq = 0;
const memId = (p: string): string => `${p}-${++memSeq}`;

export class InMemoryProviderRepo implements ProviderRepo {
  readonly providers: ProviderRow[] = [];
  readonly models: RegistryModelRow[] = [];
  readonly policies: ProviderPolicyRow[] = [];
  readonly health: ProviderHealthInput[] = [];

  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1));
  }

  async listProviders() {
    return this.providers;
  }
  async getProvider(id: string) {
    return this.providers.find((p) => p.id === id);
  }
  async createProvider(input: CreateProviderInput) {
    const row = {
      id: memId('prov'),
      providerType: input.providerType,
      displayName: input.displayName,
      enabled: input.enabled ?? false,
      baseUrlSecretRef: input.baseUrlSecretRef ?? null,
      configSecretRef: input.configSecretRef ?? null,
      apiTokenSecretRef: input.apiTokenSecretRef ?? null,
      allowedDataClasses: input.allowedDataClasses ?? null,
      allowedRoles: input.allowedRoles ?? null,
      localOnly: input.localOnly ?? true,
      cloudAllowed: input.cloudAllowed ?? false,
      auditLevel: input.auditLevel ?? 'standard',
      createdAt: this.now(),
      updatedAt: this.now(),
    } as ProviderRow;
    this.providers.push(row);
    return row;
  }
  async updateProvider(id: string, patch: UpdateProviderInput) {
    const row = this.providers.find((p) => p.id === id);
    if (!row) return undefined;
    Object.assign(row, patch);
    return row;
  }
  async listModels(providerId?: string) {
    return providerId ? this.models.filter((m) => m.providerId === providerId) : this.models;
  }
  async createModel(input: CreateModelInput) {
    const row = {
      id: memId('model'),
      providerId: input.providerId,
      modelId: input.modelId,
      purpose: input.purpose ?? null,
      contextWindow: input.contextWindow ?? null,
      maxParallelRequests: input.maxParallelRequests ?? null,
      defaultTimeoutMs: input.defaultTimeoutMs ?? null,
      defaultTemperature: input.defaultTemperature ?? null,
      supportsVision: input.supportsVision ?? false,
      supportsJsonExtraction: input.supportsJsonExtraction ?? false,
      supportsEmbeddings: input.supportsEmbeddings ?? false,
      embeddingDim: input.embeddingDim ?? null,
      notes: input.notes ?? null,
      createdAt: this.now(),
      updatedAt: this.now(),
    } as RegistryModelRow;
    this.models.push(row);
    return row;
  }
  async updateModel(id: string, patch: UpdateModelInput) {
    const row = this.models.find((m) => m.id === id);
    if (!row) return undefined;
    Object.assign(row, patch);
    return row;
  }
  async listPolicies() {
    return this.policies;
  }
  async createPolicy(input: CreatePolicyInput) {
    const row = {
      id: memId('policy'),
      name: input.name,
      providerType: input.providerType ?? null,
      dataClass: input.dataClass,
      decision: input.decision,
      localOnlyRequired: input.localOnlyRequired ?? false,
      cloudAllowed: input.cloudAllowed ?? false,
      reason: input.reason ?? null,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      createdAt: this.now(),
      updatedAt: this.now(),
    } as ProviderPolicyRow;
    this.policies.push(row);
    return row;
  }
  async updatePolicy(id: string, patch: UpdatePolicyInput) {
    const row = this.policies.find((p) => p.id === id);
    if (!row) return undefined;
    Object.assign(row, patch);
    return row;
  }
  async recordHealth(input: ProviderHealthInput) {
    this.health.push(input);
  }
}
