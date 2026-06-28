// Shared flat ESLint config for the whole monorepo.
//
// Frontend import boundaries are enforced here via `no-restricted-imports`
// (specifier-based, so no module-resolution flakiness). This is one of FOUR
// layers guarding the "frontend never calls external services directly" rule;
// the others are: pnpm's non-flat node_modules (physical isolation),
// scripts/check-frontend-boundaries.mjs (independent CI gate), and Vite refusing
// to polyfill node built-ins (build-time failure).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Server/node-only @su10 packages that the browser bundle must never import.
// `@su10/config` (bare) is the server entry; `@su10/config/public` is allowed.
const SERVER_ONLY = [
  '@su10/db',
  '@su10/s3',
  '@su10/llm',
  '@su10/oidc',
  '@su10/rag',
  '@su10/connectors',
  '@su10/tools',
  '@su10/tool-base',
  '@su10/mcp',
  '@su10/agents',
  '@su10/workflow-engine',
  '@su10/audit',
  '@su10/permissions',
  '@su10/observability',
  '@su10/fastify-security',
  '@su10/logger',
  '@su10/config',
];

const BROWSER_GLOBS = [
  'apps/ai-portal-web/**/*.{ts,tsx}',
  'packages/ui/**/*.{ts,tsx}',
  'packages/portal-agent-widgets/**/*.{ts,tsx}',
];

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already checks undefined identifiers; avoid env/global noise.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Запрет обхода Tool Broker: агентная/воркфлоу-ЛОГИКА может импортировать
    // ТОЛЬКО ядро `@su10/tools` (тип ToolBroker), но НЕ базовые инструменты
    // `@su10/tool-base` (их handler'ы исполняются исключительно через брокер).
    // Композиционные корни процессов (agent-api server.ts, temporal-worker host)
    // в этот список НЕ входят — они собирают broker из tool-base, как и положено.
    files: [
      'packages/agents/**/*.{ts,tsx}',
      'packages/workflow-engine/**/*.{ts,tsx}',
      'workers/agent-worker/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@su10/tool-base',
              message:
                'Agents/workflows must invoke tools only via ToolBroker (@su10/tools); do not import base tool handlers.',
            },
          ],
          patterns: [
            {
              group: ['@su10/tool-base/*'],
              message: 'Do not deep-import base tool handlers; execute tools via ToolBroker.invoke.',
            },
          ],
        },
      ],
    },
  },
  {
    files: BROWSER_GLOBS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: SERVER_ONLY.map((name) => ({
            name,
            message: `Server-only package "${name}" must not be imported in browser code (use the backend API).`,
          })),
          patterns: [
            {
              group: [
                'pg',
                'postgres',
                'drizzle-orm',
                'drizzle-orm/*',
                '@aws-sdk/*',
                'openai',
                '@temporalio/*',
                'pino',
                'pino/*',
                'fastify',
                'fastify/*',
                'node:*',
              ],
              message: 'No server/node-only library may be imported in browser code.',
            },
          ],
        },
      ],
    },
  },
  prettier,
];
