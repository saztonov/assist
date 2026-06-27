# MASTER ARCHITECTURE CONTRACT

Version: 1.0 • Status: NORMATIVE • Change process: ADR + architecture owner sign-off

## Purpose

The non-negotiable invariants of the AI/Agent Portal. Subordinate documents
([ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md), package READMEs, ADRs) MUST
conform. On conflict, **this contract prevails**.

## Invariants

- **I1 — Single ingress for side effects.** The browser performs no privileged
  external call; all side effects pass through backend / worker / connector.
  (AB-1..AB-5)
- **I2 — LLM only via gateway.** LM Studio is reachable ONLY through the backend
  `@su10/llm` gateway. No app, worker or frontend talks to it directly. (LLM-1..2)
- **I3 — Authorization on the backend.** Business authorization is decided on the
  backend; the client is never trusted. (AZ-1..4)
- **I4 — ACL before the model.** Data the caller is not entitled to never reaches
  the model or the client; RAG ACL-filters before the LLM. (RAG-1..3)
- **I5 — Governed tools & MCP.** Tools and MCP run only through the Registry +
  Broker with input/output schema, permission, audit and approval. High-risk
  actions require approval. (TOOL-1..7)
- **I6 — Secrets only in secret storage.** Never in git, frontend, image, logs,
  or DB in cleartext. (SEC-1..7)
- **I7 — Idempotent side effects.** Every external side effect is idempotent;
  nothing double-applies on retry. (IDEM-1..5)
- **I8 — Migrations are a separate step.** SQL-first, versioned, applied by a
  separate deploy step, never auto-run from app/worker containers. (DEP-1..2)
- **I9 — Typed, safe errors.** Errors are typed and fail safe; no internal detail
  leaks to clients. (ERR-1..5)
- **I10 — Temporal owns task status.** Business task status = PostgreSQL
  `agent_tasks` + Temporal `workflow_id`. LangGraph checkpoints are NOT the
  source of truth. (DB-?, LLM-4)
- **I11 — Shared code is versioned.** Shared logic lives in `@su10/*` packages,
  never copy-pasted between apps. (AB-6)

## Module boundary map

- **Browser-safe:** `@su10/ui`, `@su10/portal-agent-widgets`,
  `@su10/workflow-schema`, `@su10/errors`, `@su10/config/public`.
- **Server-only:** `@su10/db`, `s3`, `oidc`, `fastify-security`, `llm`, `tools`,
  `connectors`, `mcp`, `rag`, `agents`, `workflow-engine`, `audit`, `logger`,
  `observability`, `@su10/config` (server entry).

## Conformance

CI gates are the machine proof: `typecheck`, `lint`, `test`,
`check:frontend-boundaries`, secret scan. A green pipeline is required, not
optional. Changing an invariant requires an ADR and architecture-owner approval.
