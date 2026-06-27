# ARCHITECTURE_RULES.md

> Enforceable rulebook for the AI/Agent Portal monorepo (`@su10/*`).
> Status: NORMATIVE. Keyword convention: MUST / MUST NOT / SHOULD (RFC 2119).
> Rule IDs are stable — cite them in reviews.

## 0. Scope & precedence

- Subordinate to [MASTER_ARCHITECTURE_CONTRACT.md](MASTER_ARCHITECTURE_CONTRACT.md).
  On conflict the CONTRACT wins and this file MUST be corrected.

## 1. Architecture boundaries (AB)

- **AB-1** The frontend (`ai-portal-web`) MUST NOT call LM Studio, PostgreSQL, the
  S3 private API, mail or banking APIs directly.
- **AB-2** Every external side effect MUST be reached through `agent-api`, a
  worker, or a connector. The browser talks only to the same-origin portal API.
- **AB-3** The frontend MUST NOT import any server-only `@su10/*` package or raw
  node/server SDK (`pg`, `drizzle-orm`, `@aws-sdk/*`, `openai`, `fastify`, …). It
  MAY import only browser-safe packages and `@su10/config/public`.
- **AB-4** Imports flow inward: web → browser-safe libs; api/worker → any lib. A
  package MUST NOT import an app.
- **AB-5** No hidden network calls from the frontend: all fetch endpoints MUST be
  same-origin `/api/*` (or an explicit allowlist).
- **AB-6** Shared logic MUST live in a versioned `@su10/*` package, never copy-pasted.

## 2. Data & DB access (DB)

- **DB-1** Only `agent-api` and workers MUST hold DB connections.
- **DB-2** All DB access MUST go through Drizzle ORM (or reviewed parameterised SQL).
- **DB-3** Connections MUST use TLS and a network-restricted endpoint.
- **DB-4** Runtime user and migration user MUST be separate roles; runtime has no DDL.
- **DB-5** Each DB user MUST have an explicit `conn_limit`; pools sized per the
  corporate formula.
- **DB-6** Files MUST NOT be stored in PostgreSQL — only metadata. Bytes live in S3.

## 3. Auth & authorization (AZ)

- **AZ-1** Authentication MUST be delegated to Keycloak (AD via LDAPS for staff).
- **AZ-2** Business authorization MUST be enforced on the backend on every request.
  Client-side role checks are UX only.
- **AZ-3** Every protected route MUST verify a validated OIDC token (sig/iss/aud/exp).
- **AZ-4** Object-level authz MUST be checked at the data-access boundary.

## 4. LLM & agents (LLM)

- **LLM-1** LM Studio MUST be accessed ONLY through `@su10/llm`.
- **LLM-2** The LM Studio base URL/token MUST come from secret storage and MUST NOT
  appear in frontend bundles or logs.
- **LLM-3** Every prompt MUST pass RAG ACL filtering and zod validation first.
- **LLM-4** Agent runtime (LangGraph.js) runs only in backend/worker; agents act
  only via the Tool Broker. LangGraph checkpoints are not the status source of truth.
- **LLM-5** Prompts/completions/tool args MUST be logged only redacted.

## 5. Tools & MCP (TOOL)

- **TOOL-1** Tools MUST be invoked only through the Tool Registry + Tool Broker.
- **TOOL-2** Every tool MUST declare input_schema, output_schema, risk_level,
  permission check, audit hook and approval policy, or it MUST NOT register.
- **TOOL-3** The Broker MUST validate I/O against schemas; on mismatch reject, not coerce.
- **TOOL-4** High-risk actions MUST require explicit approval before execution.
- **TOOL-5** Every tool invocation MUST emit an audit event.
- **TOOL-6** MCP servers MUST be reached only via the managed registry allowlist.
- **TOOL-7** MCP calls MUST enforce per-server permissions and emit audit events.

## 6. RAG & ACL (RAG)

- **RAG-1** RAG MUST apply ACL filtering BEFORE any content reaches the LLM.
- **RAG-2** ACL filtering MUST happen in the retrieval/query layer, not as a prompt note.
- **RAG-3** A document the user may not see MUST NOT appear in context or citations.
- **RAG-4** Embedding/search MUST run backend-side; the frontend MUST NOT query pgvector.

## 7. Secrets & logging (SEC)

- **SEC-1** Secrets MUST NOT exist in git, frontend, image, logs, or DB cleartext.
- **SEC-2** The repo MUST contain only `.env.example` with placeholders.
- **SEC-3** Logs MUST NOT contain access/refresh tokens, Authorization headers, the
  LM Studio token, presigned URLs, passwords, or full PII bodies (enforced by
  `@su10/logger` redaction).
- **SEC-4** All logging MUST go through `@su10/logger` (pino JSON).
- **SEC-5** Error responses MUST NOT leak stack traces, SQL or internal hostnames.

## 8. Idempotency & side effects (IDEM)

- **IDEM-1** Every external side effect MUST be idempotent, keyed by an idempotency key.
- **IDEM-2** The PostgreSQL transactional outbox handles simple side-effect delivery
  with retry/backoff and `attempts/max_attempts/next_run_at/locked_until/dead-state`.
- **IDEM-3** Job claiming MUST use PostgreSQL row locking (multi-worker safe, HA-ready).
- **IDEM-4** A retried operation MUST NOT double-apply its effect.

## 9. Error handling (ERR)

- **ERR-1** Thrown errors MUST extend `AppError` from `@su10/errors`.
- **ERR-2** Handlers MUST map errors to safe HTTP responses via a single serializer.
- **ERR-3** Unknown errors MUST become a generic 500 with a correlation id.
- **ERR-4** Validation failures (zod) MUST return 4xx with non-sensitive messages.

## 10. Testing & quality gates (Q)

- **Q-1** TypeScript MUST compile under `strict`.
- **Q-2** Critical logic (authz, RAG ACL filter, Tool Broker approval, idempotency,
  error serializer, config schema, log redaction) MUST have unit tests.
- **Q-3** CI MUST run typecheck, lint (incl. boundary checks), tests, and secret scan.

## 11. Deployment & migrations (DEP)

- **DEP-1** `drizzle-kit push` MUST NOT be used in production; migrations are SQL-first.
- **DEP-2** Migrations MUST be applied as a separate deploy step, never auto-run from
  app/worker containers.
- **DEP-3** Production VPS MUST NOT run `git pull` / `npm install` / `npm run build`;
  only immutable image tags are deployed.
- **DEP-4** The workflow engine for agent tasks is Temporal; the PG outbox is a
  complementary idempotent side-effect layer, not a replacement for orchestration.
