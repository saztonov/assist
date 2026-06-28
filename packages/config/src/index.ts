/**
 * Server-side configuration. NODE-ONLY — never import this from browser code
 * (use `@su10/config/public`). Validates process env with zod and fails fast.
 */
import { z } from 'zod';

const boolish = z.enum(['true', 'false']).transform((v) => v === 'true');

/**
 * Map LM Studio env aliases to the canonical names BEFORE validation, so the
 * skill-file names (`LMSTUDIO_*` / `LM_STUDIO_*`) are accepted too. Canonical
 * names always win when explicitly set.
 */
function applyEnvAliases(raw: unknown): Record<string, unknown> {
  const env: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  env.LLM_STUDIO_BASE_URL ??= env.LMSTUDIO_BASE_URL ?? env.LM_STUDIO_BASE_URL;
  env.LLM_STUDIO_API_TOKEN ??= env.LMSTUDIO_API_KEY ?? env.LM_STUDIO_API_TOKEN;
  return env;
}

const serverObjectSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HTTP_HOST: z.string().default('0.0.0.0'),
    HTTP_PORT: z.coerce.number().int().positive().default(8080),

    // Runtime DB user (no DDL). The migration user is intentionally NOT read here.
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
    TEMPORAL_TASK_QUEUE: z.string().min(1).default('ai-portal'),

    // LM Studio is reachable ONLY through the backend llm-gateway.
    LLM_STUDIO_BASE_URL: z.string().url(),
    LLM_STUDIO_API_TOKEN: z.string().min(1),

    // LM Studio model ids (routing). Canonical names from the LM Studio skill:
    //   chandra-ocr-2 → OCR/Markdown; lift → strict JSON; qwen36-27b-mtp → analysis.
    CHANDRA_MODEL: z.string().min(1).default('chandra-ocr-2'),
    LIFT_MODEL: z.string().min(1).default('lift'),
    QWEN_MODEL: z.string().min(1).default('qwen36-27b-mtp'),

    // Default model per task class (used when a caller does not pin a model).
    LLM_DEFAULT_CHAT_MODEL: z.string().min(1).default('qwen36-27b-mtp'),
    LLM_DEFAULT_OCR_MODEL: z.string().min(1).default('chandra-ocr-2'),
    LLM_DEFAULT_EXTRACTION_MODEL: z.string().min(1).default('lift'),

    // Per-model concurrency caps (skill limits: chandra=4, lift=4, qwen=1).
    LLM_MAX_PARALLEL_CHANDRA: z.coerce.number().int().positive().default(4),
    LLM_MAX_PARALLEL_LIFT: z.coerce.number().int().positive().default(4),
    LLM_MAX_PARALLEL_QWEN: z.coerce.number().int().positive().default(1),

    // Timeout / bounded retry for LM Studio calls.
    LLM_TIMEOUT_MS_DEFAULT: z.coerce.number().int().positive().default(300000),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

    // Embedding provider — SEPARATE from chat/vision models. `mock` is the
    // local-first default and is rejected in production (see refine below):
    // chandra/lift/qwen MUST NOT be used as embedding models.
    EMBEDDING_PROVIDER: z.string().min(1).default('mock'),
    EMBEDDING_MODEL: z.string().min(1).default('mock-embed'),
    EMBEDDING_DIM: z.coerce
      .number()
      .int()
      .refine((d) => d === 768 || d === 1536, 'EMBEDDING_DIM must be 768 or 1536')
      .default(768),

    // Documents / S3-compatible storage. S3_* are validated only when documents
    // are enabled (local-first default keeps the app bootable without S3).
    DOCUMENTS_ENABLED: boolish.default('false'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: boolish.default('true'),
    S3_PRESIGN_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900),

    // Read-only mail connector (generic IMAP; drafts via APPEND, NEVER sends).
    // Distinct from the SES/Postbox send block (MAIL_PROVIDER/MAIL_FROM/...).
    // Attachments are saved to S3, so enabling requires S3 (see refine below).
    MAIL_CONNECTOR_ENABLED: boolish.default('false'),
    MAIL_IMAP_DEFAULT_HOST: z.string().min(1).optional(),
    MAIL_IMAP_DEFAULT_PORT: z.coerce.number().int().positive().default(993),
    MAIL_IMAP_DEFAULT_SECURE: boolish.default('true'),
    MAIL_IMAP_DEFAULT_DRAFTS_MAILBOX: z.string().min(1).default('Drafts'),
    MAIL_RATE_LIMIT_CAPACITY: z.coerce.number().int().positive().default(10),
    MAIL_RATE_LIMIT_REFILL_PER_SEC: z.coerce.number().positive().default(2),
    MAIL_MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(26_214_400),
    MAIL_BODY_MAX_CHARS: z.coerce.number().int().positive().default(50_000),

    RAG_ACL_ENFORCE: boolish.default('true'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  })
  .refine((e) => e.RAG_ACL_ENFORCE === true, {
    message: 'RAG_ACL_ENFORCE must remain true (CONTRACT I4 / RAG-1)',
    path: ['RAG_ACL_ENFORCE'],
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.EMBEDDING_PROVIDER === 'mock'), {
    message:
      'EMBEDDING_PROVIDER must not be "mock" in production (an approved embedding provider is required)',
    path: ['EMBEDDING_PROVIDER'],
  })
  .refine(
    (e) =>
      !e.DOCUMENTS_ENABLED ||
      Boolean(
        e.S3_ENDPOINT && e.S3_REGION && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY,
      ),
    {
      message:
        'DOCUMENTS_ENABLED requires S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
      path: ['DOCUMENTS_ENABLED'],
    },
  )
  .refine(
    (e) =>
      !e.MAIL_CONNECTOR_ENABLED ||
      Boolean(
        e.S3_ENDPOINT && e.S3_REGION && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY,
      ),
    {
      message:
        'MAIL_CONNECTOR_ENABLED requires S3_* (attachments are saved to S3): S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
      path: ['MAIL_CONNECTOR_ENABLED'],
    },
  );

export const serverEnvSchema = z.preprocess(applyEnvAliases, serverObjectSchema);

export type ServerConfig = z.infer<typeof serverObjectSchema>;

/** Parse + validate. On failure prints only error PATHS (never values) and exits. */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`[config] invalid environment, refusing to start:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}
