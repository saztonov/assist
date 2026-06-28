/** Zod DTOs for the LLM admin API. `.strict()` rejects accidental raw-secret keys. */
import { z } from 'zod';

export const ProviderCreateBody = z
  .object({
    providerType: z.enum([
      'lmstudio',
      'openai_compatible_saas',
      'embedding_provider',
      'rerank_provider',
      'saas_api',
    ]),
    displayName: z.string().min(1).max(200),
    enabled: z.boolean().optional(),
    // SECRET REFERENCES only (e.g. "env:NAME" / Lockbox key) — never a raw secret.
    apiTokenSecretRef: z.string().min(1).max(200).optional(),
    baseUrlSecretRef: z.string().min(1).max(200).optional(),
    localOnly: z.boolean().optional(),
    cloudAllowed: z.boolean().optional(),
    allowedRoles: z.array(z.string()).max(50).optional(),
    allowedDataClasses: z.array(z.string()).max(50).optional(),
  })
  .strict();

export const ProviderUpdateBody = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    localOnly: z.boolean().optional(),
    cloudAllowed: z.boolean().optional(),
    apiTokenSecretRef: z.string().min(1).max(200).optional(),
    baseUrlSecretRef: z.string().min(1).max(200).optional(),
  })
  .strict();

export const ProviderResponse = z.object({
  id: z.string(),
  providerType: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  localOnly: z.boolean(),
  cloudAllowed: z.boolean(),
  hasToken: z.boolean(),
});

export const ProvidersResponse = z.object({ providers: z.array(ProviderResponse) });

export const ModelCreateBody = z
  .object({
    modelId: z.string().min(1).max(200),
    purpose: z.enum(['chat', 'ocr', 'extraction', 'analysis', 'embedding']).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxParallelRequests: z.number().int().positive().optional(),
    supportsVision: z.boolean().optional(),
    supportsJsonExtraction: z.boolean().optional(),
    supportsEmbeddings: z.boolean().optional(),
    embeddingDim: z.number().int().positive().optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

export const ModelUpdateBody = z
  .object({
    purpose: z.enum(['chat', 'ocr', 'extraction', 'analysis', 'embedding']).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxParallelRequests: z.number().int().positive().optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

export const ModelResponse = z.object({
  id: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  purpose: z.string().nullable(),
  contextWindow: z.number().nullable(),
  maxParallelRequests: z.number().nullable(),
});

export const ModelsResponse = z.object({ models: z.array(ModelResponse) });

export const MergedModelsResponse = z.object({
  models: z.array(
    z.object({
      modelId: z.string(),
      purpose: z.string().nullable(),
      contextWindow: z.number().nullable(),
      maxParallelRequests: z.number().nullable(),
      registered: z.boolean(),
      available: z.boolean(),
    }),
  ),
});

export const HealthResponse = z.object({
  status: z.string(),
  models: z.array(z.string()),
  errorCode: z.string().optional(),
});

export const PolicyCreateBody = z
  .object({
    name: z.string().min(1).max(200),
    providerType: z.string().max(100).optional(),
    dataClass: z.string().min(1).max(100),
    decision: z.enum(['allow', 'deny']),
    localOnlyRequired: z.boolean().optional(),
    cloudAllowed: z.boolean().optional(),
    reason: z.string().max(500).optional(),
    priority: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const PolicyUpdateBody = z
  .object({
    decision: z.enum(['allow', 'deny']).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().optional(),
  })
  .strict();

export const PolicyResponse = z.object({
  id: z.string(),
  name: z.string(),
  dataClass: z.string(),
  decision: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
});

export const PoliciesResponse = z.object({ policies: z.array(PolicyResponse) });

export const ModelTestResponse = z.object({
  ok: z.boolean(),
  model: z.string().optional(),
  errorCode: z.string().optional(),
});

export const IdParams = z.object({ id: z.string().min(1) });
export const ProviderIdParams = z.object({ id: z.string().min(1) });
export const ModelIdParams = z.object({ modelId: z.string().min(1) });
