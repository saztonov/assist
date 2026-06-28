/**
 * Контракты реестра провайдеров: zod-схемы строк, безопасная public-проекция
 * (allow-list, без сырых секретов), оценка политики (fail-closed) и резолвер
 * размерности эмбеддингов по провайдеру.
 *
 * БЕЗОПАСНОСТЬ: провайдеры хранят только метаданные и secret-references.
 * `toPublicProviderConfig` использует allow-list — даже если в строке окажется
 * сырой секрет, он не попадёт в результат.
 */
import { z } from 'zod';

export const ProviderTypeSchema = z.enum([
  'lmstudio',
  'cloud_llm',
  'saas_api',
  'internal_api',
  'embedding_provider',
  'rerank_provider',
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const DataClassSchema = z.enum(['public', 'internal', 'confidential', 'secret']);
export type DataClass = z.infer<typeof DataClassSchema>;

/** Классы данных, для которых cloud/SaaS-провайдеры запрещены. */
export const SENSITIVE_DATA_CLASSES: ReadonlySet<DataClass> = new Set<DataClass>([
  'confidential',
  'secret',
]);

/** Строка реестра LLM-провайдера (метаданные + secret-ref). */
export const ProviderRegistryRowSchema = z.object({
  id: z.string().optional(),
  providerType: ProviderTypeSchema,
  displayName: z.string().min(1),
  enabled: z.boolean().default(false),
  baseUrlSecretRef: z.string().nullish(),
  configSecretRef: z.string().nullish(),
  apiTokenSecretRef: z.string().nullish(),
  allowedDataClasses: z.array(DataClassSchema).nullish(),
  allowedRoles: z.array(z.string()).nullish(),
  localOnly: z.boolean().default(true),
  cloudAllowed: z.boolean().default(false),
  auditLevel: z.string().default('standard'),
});
export type ProviderRegistryRow = z.infer<typeof ProviderRegistryRowSchema>;

/** Строка модели провайдера. */
export const ProviderModelRowSchema = z.object({
  id: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().min(1),
  purpose: z.string().nullish(),
  contextWindow: z.number().int().positive().nullish(),
  maxParallelRequests: z.number().int().positive().nullish(),
  defaultTimeoutMs: z.number().int().positive().nullish(),
  defaultTemperature: z.number().nullish(),
  supportsVision: z.boolean().default(false),
  supportsJsonExtraction: z.boolean().default(false),
  supportsEmbeddings: z.boolean().default(false),
  embeddingDim: z.number().int().positive().nullish(),
  notes: z.string().nullish(),
});
export type ProviderModelRow = z.infer<typeof ProviderModelRowSchema>;

/**
 * Поля, безопасные для возврата наружу. Только метаданные и ИМЕНА secret-ref
 * (ссылки на secret store), но НЕ значения секретов.
 */
const PUBLIC_PROVIDER_KEYS = [
  'id',
  'providerType',
  'displayName',
  'enabled',
  'localOnly',
  'cloudAllowed',
  'auditLevel',
  'allowedDataClasses',
  'allowedRoles',
  'baseUrlSecretRef',
  'configSecretRef',
  'apiTokenSecretRef',
] as const;

export type PublicProviderConfig = Partial<
  Pick<ProviderRegistryRow, (typeof PUBLIC_PROVIDER_KEYS)[number] & keyof ProviderRegistryRow>
>;

/**
 * Allow-list проекция строки провайдера. Возвращает только безопасные поля;
 * любые посторонние/сырые секрет-поля отбрасываются.
 */
export function toPublicProviderConfig(row: Record<string, unknown>): PublicProviderConfig {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_PROVIDER_KEYS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out as PublicProviderConfig;
}

export interface ProviderPolicyInput {
  providerType: ProviderType;
  dataClass: DataClass;
  localOnly?: boolean;
  cloudAllowed?: boolean;
}

export interface ProviderPolicyDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Оценка политики провайдера (fail-closed): cloud/SaaS-провайдеры (или любой
 * не-локальный провайдер) ЗАПРЕЩЕНЫ для sensitive data (confidential/secret).
 */
export function evaluateProviderPolicy(input: ProviderPolicyInput): ProviderPolicyDecision {
  const sensitive = SENSITIVE_DATA_CLASSES.has(input.dataClass);
  const cloudLike =
    input.providerType === 'cloud_llm' ||
    input.providerType === 'saas_api' ||
    input.cloudAllowed === true ||
    input.localOnly === false;

  if (sensitive && cloudLike) {
    return {
      allowed: false,
      reason: `cloud/SaaS-провайдер запрещён для класса данных "${input.dataClass}"`,
    };
  }
  return { allowed: true };
}

/**
 * Размерность эмбеддингов по провайдеру: Yandex Embeddings → 768, прочие → 1536.
 * Должна совпадать с выбором таблицы хранения (rag.corpus_embeddings_768/_1536).
 */
export function resolveEmbeddingDim(provider: string): 768 | 1536 {
  return /^yandex/i.test(provider) ? 768 : 1536;
}
