import { defineConfig } from 'drizzle-kit';

// SQL-first migrations. `drizzle-kit push` is NOT used in production; versioned
// SQL files in ./drizzle are applied by a SEPARATE deploy step (never auto-run
// from app/worker containers).
export default defineConfig({
  schema: './src/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? 'postgres://localhost:5432/agent_platform_db',
  },
});
