# AI/Agent Portal (`@su10/*`)

Corporate AI/Agent Portal monorepo — agentic backend + employee AI portal.
Single-VPS baseline (corporate standard v3.1). TypeScript, ESM-only, strict mode.

> **Governing documents (read first)**
> - [docs/MASTER_ARCHITECTURE_CONTRACT.md](docs/MASTER_ARCHITECTURE_CONTRACT.md) — binding invariants
> - [docs/ARCHITECTURE_RULES.md](docs/ARCHITECTURE_RULES.md) — enforceable rules

## Stack

Node.js + TypeScript + Fastify · React + Ant Design 5 · Drizzle ORM (SQL-first
migrations) · zod · pino · Keycloak + AD/OIDC · Temporal · LangGraph.js · LM
Studio (via backend llm-gateway) · PostgreSQL + pgvector (RAG) · pnpm + Turborepo.

## Layout

```
apps/agent-api          Fastify backend (security, llm-gateway edge, task/template routes)
apps/ai-portal-web      React + AntD5 (browser-safe; Visual Builder saves WorkflowTemplate JSON)
workers/temporal-worker Temporal Worker host (injected activities)
workers/agent-worker    LangGraph.js reasoning/tool steps
workers/document-worker document processing (idempotent)
packages/*              @su10/* shared libraries (browser-safe | server-only)
tooling/*               shared tsconfig + eslint-config
docs/ infra/            governing docs + single-VPS deployment skeleton
```

### Package targets

| Browser-safe | Server-only |
|---|---|
| `ui`, `portal-agent-widgets`, `workflow-schema`, `errors`, `config/public` | `db`, `s3`, `oidc`, `fastify-security`, `llm`, `tools`, `mcp`, `connectors`, `rag`, `agents`, `workflow-engine`, `audit`, `logger`, `observability`, `config` |

## Prerequisites

- Node 22+ (`.nvmrc`), pnpm via corepack (`corepack enable`).

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env   # fill placeholders; real secrets come from Yandex Lockbox
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | run all dev tasks (Turborepo) |
| `pnpm build` | build every workspace (tsup libs + vite web), topologically |
| `pnpm typecheck` | `tsc --noEmit` across workspaces |
| `pnpm test` | run all unit tests (Vitest) |
| `pnpm lint` | ESLint incl. frontend import restrictions |
| `pnpm check:frontend-boundaries` | independent gate: frontend imports/network |
| `pnpm secret:scan` | gitleaks secret scan (CI-enforced) |
| `pnpm format` | Prettier write |

## Migrations

SQL-first via Drizzle Kit in [packages/db](packages/db). `drizzle-kit generate`
creates versioned SQL in `packages/db/drizzle/`; production applies them as a
**separate deploy step** (never auto-run from app/worker containers; `push` is
not used in production).

## Every deliverable MUST include

- [ ] Changed files (paths added/modified/removed)
- [ ] Test commands + what they cover
- [ ] Migration description (forward/backward safety; separate step)
- [ ] Env / secrets list (added to `.env.example` with placeholders; none committed)
- [ ] Residual risks
- [ ] Contract/Rules conformance (which invariants/rule IDs apply)
