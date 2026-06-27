/**
 * Server-side configuration. NODE-ONLY — never import this from browser code
 * (use `@su10/config/public`). Validates process env with zod and fails fast.
 */
import { z } from 'zod';

const boolish = z.enum(['true', 'false']).transform((v) => v === 'true');

export const serverEnvSchema = z
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

    RAG_ACL_ENFORCE: boolish.default('true'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
  })
  .refine((e) => e.RAG_ACL_ENFORCE === true, {
    message: 'RAG_ACL_ENFORCE must remain true (CONTRACT I4 / RAG-1)',
    path: ['RAG_ACL_ENFORCE'],
  });

export type ServerConfig = z.infer<typeof serverEnvSchema>;

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
