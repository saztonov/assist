# @su10/agent-api

Fastify backend — the **only** public HTTP surface of the AI/Agent Portal. It
validates all I/O with zod, enforces Keycloak/OIDC authorization on the backend,
and exposes the route skeleton that later stages fill in. It never runs agent
reasoning itself (that is Temporal + LangGraph workers).

This is the **stage-2 foundation**: server bootstrap, health, OIDC/JWT middleware,
request context, structured logging with redaction, typed error handling, the
10 route groups (as 501 stubs), and OpenAPI. Real endpoints arrive in later stages.

## Local-first

Nothing connects to real services until the portal is finally deployed.
`buildApp()` performs **no** network I/O; readiness checks are off by default;
OIDC verifies **local dev tokens** without a live Keycloak.

```bash
# 1) mint a matched (JWKS, token) pair — no Keycloak needed
pnpm --filter @su10/agent-api mint-dev-token alice portal_user,tasks.read
#    → prints OIDC_DEV_JWKS=... and a Bearer token

# 2) put the printed OIDC_DEV_JWKS (plus the rest of .env.example) in your env, then:
pnpm --filter @su10/agent-api dev          # tsx watch src/server.ts

# 3) exercise it
curl localhost:8080/health/live                                  # {"status":"ok"}
curl localhost:8080/health/ready                                 # {"status":"ok","checks":[]}
curl localhost:8080/api/v1/agent/tasks                           # 401 envelope (no token)
curl -H "Authorization: Bearer <token>" localhost:8080/api/v1/agent/tasks   # 501 NOT_IMPLEMENTED
curl localhost:8080/openapi.json                                 # OpenAPI 3.1 + bearerAuth
```

## Surface

| Route | Auth | Notes |
|---|---|---|
| `GET /health/live` | public | liveness, dependency-free |
| `GET /health/ready` | public | aggregates injected checks (empty by default) |
| `GET /health` | public | deprecated alias (removed at deploy stage) |
| `GET /openapi.json` | public | spec; `/docs` UI behind `OPENAPI_UI_ENABLED` |
| `GET /api/v1/system/info` | public | build info |
| `GET /api/v1/{agent/tasks,agent/chat,documents,rag,tools,mcp,connectors,approvals,artifacts,audit}` | **Bearer JWT** | 501 stubs |

Errors use one wire contract: `{ error: { code, message, correlationId, details? } }`.
Auth is enforced by **Fastify encapsulation** (the auth hook lives only inside the
authenticated scope), not by path matching.

## Config / secrets

See root [`.env.example`](../../.env.example). Config is loaded by
`loadAgentApiConfig()` (composes `@su10/config.loadServerConfig`). For local boot,
placeholder-but-shape-valid `DATABASE_URL` / `LLM_STUDIO_*` are enough — nothing
connects. The only secret here is `LLM_STUDIO_API_TOKEN` (Lockbox); **no OIDC client
secret is needed** (resource-server validates via public JWKS).

## Keycloak prerequisites (for the future live deployment, not local dev)

- **Audience mapper** so the access token's `aud` contains `agent-api` (otherwise
  Keycloak emits `aud: "account"` and we fall back to matching `azp` = `OIDC_CLIENT_ID`).
- **Group Membership mapper** (claim `groups`, full path) if group-based authz is
  used — without it `groups` is simply `[]`.
- Client roles for the `agent-api` client are the authoritative authz roles
  (`OIDC_RESOURCE_CLIENT`); realm roles are coarse/global.

## Tests

```bash
pnpm --filter @su10/oidc test
pnpm --filter @su10/fastify-security test
pnpm --filter @su10/agent-api test
# or the whole repo:
pnpm test && pnpm typecheck && pnpm lint && pnpm check:frontend-boundaries
```

## Migrations

**None** in stage 2 (API layer only). The DB schema (`agent_platform_db`) and the
DB readiness check land in stage 3.

## Residual risks

- Live Keycloak/JWKS not exercised here — covered by local-signed tokens; a real
  token is validated at a later integration step.
- Per-user rate-limiting falls back to per-IP at this stage (the global limiter
  runs before auth); refine when needed. Set `TRUST_PROXY=true` behind nginx.
- `OIDC_DEV_JWKS` is local-only and rejected when `NODE_ENV=production`.
