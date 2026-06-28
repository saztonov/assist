/**
 * Test-only helper: a full `ServerConfig` with every default filled by the real
 * `serverEnvSchema`. Keeps test config literals DRY and future-proof as new env
 * fields are added.
 */
import { serverEnvSchema, type ServerConfig } from '@su10/config';

export function testServerConfig(overrides: Record<string, string> = {}): ServerConfig {
  return serverEnvSchema.parse({
    DATABASE_URL: 'postgres://placeholder/db',
    LLM_STUDIO_BASE_URL: 'http://localhost:1234/v1',
    LLM_STUDIO_API_TOKEN: 'placeholder',
    NODE_ENV: 'test',
    ...overrides,
  });
}
