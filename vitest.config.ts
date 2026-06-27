import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const pkg = (p: string) => resolve(dir, 'packages', p);

// Tests run against package SOURCE (not built dist) via these aliases, so the
// suite is green without a prior build. `@su10/config/public` must precede the
// generic rule because it maps to a non-index entry point.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@su10/config/public', replacement: pkg('config/src/public.ts') },
      { find: /^@su10\/(.*)$/, replacement: pkg('$1/src/index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.{ts,tsx}',
      'apps/**/src/**/*.test.{ts,tsx}',
      'workers/**/src/**/*.test.{ts,tsx}',
    ],
    coverage: { provider: 'v8', reporter: ['text'] },
  },
});
