# @su10/mail-connector

Read-only mail connector (v1). Generic **IMAP** behind an abstract
`MailProviderPort`, exposed to agents as six tools that run **only** through the
Tool Broker, plus a deterministic stub for tests. **No send capability exists** in
this package — drafts are created via IMAP `APPEND` only.

## Tools (all `category: 'connector'`, Tool Broker only)

| Tool | risk | what it does |
|------|------|--------------|
| `mail.connection.list` | low | Connections the caller owns/may use (no secrets/host) |
| `mail.search` | low | Search a mailbox → summaries only (no bodies) |
| `mail.get_message` | low | Full message; bodies truncated to `MAIL_BODY_MAX_CHARS` |
| `mail.get_attachments` | low | Attachment **metadata only** (no bytes in output); enforces a byte cap |
| `mail.save_attachments_to_s3` | medium | Save attachments to S3 as documents (idempotent), optional document-worker processing |
| `mail.create_draft` | medium | Compose + IMAP `APPEND` a draft. **Never sends.** |

Required role = the tool name (e.g. `mail.search`), or `admin`. Object-level
access (owner / `connector_permissions`) is enforced in each handler via
`canUseConnector` at the data boundary.

## Provider mapping

All targets are the **same** `ImapMailProvider`; differences are confined to
`connector_accounts.metadata_json` (`host`/`port`/`secure`/`mailbox`/
`draftsMailbox`/`authType`/`providerKind`) + a `secret_ref`.

- **Yandex 360 (IMAP):** `imap.yandex.ru:993` TLS, app-password (recommended) or
  OAuth2 (XOAUTH2). Drafts folder `Drafts`.
- **Yandex Cloud Postbox:** primarily a send service; for read-only v1 point the
  connector at the downstream IMAP mailbox it delivers to.
- **Cloudflare Email Routing:** a routing layer, not an IMAP store; configure the
  destination IMAP mailbox it forwards to. No Cloudflare-specific code.

## No-send guarantee

`MailProviderPort` has no `send`; `ImapMailProvider` never constructs an SMTP
transport (`nodemailer`'s `MailComposer` builds bytes only). `createDraft` =
`client.append(Drafts, rfc822, ['\\Draft'])`. A unit test asserts no `send`
surface is reachable.

## Configuration (env, via `@su10/config`)

`MAIL_CONNECTOR_ENABLED` (gate; requires S3), `MAIL_IMAP_DEFAULT_*`,
`MAIL_RATE_LIMIT_CAPACITY` / `MAIL_RATE_LIMIT_REFILL_PER_SEC`,
`MAIL_MAX_ATTACHMENT_BYTES`, `MAIL_BODY_MAX_CHARS`. Per-account secrets are
`secret_ref` values resolved at call time — never stored raw, never logged.

## Security

- Credentials live only as `secret_ref`; `metadata_json` is validated by a strict
  schema that rejects unknown/secret-like keys.
- Never logged: message bodies/subjects/addresses, attachment bytes, presigned
  URLs, `Authorization`, the composed MIME, the resolved secret. IMAP/parser debug
  logging is off (`logger: false`).
- Attachment bytes are never returned in tool output; persist them via
  `mail.save_attachments_to_s3`.

## Testing

`pnpm exec vitest run --root <repo> mail-connector` — stub provider, rate limiter,
config, and broker-driven tool tests (ACL, role gate, byte cap, body truncation,
idempotent save, no-send, audit redaction). No network.

## Manual smoke (outside CI — real IMAP, e.g. Yandex 360)

1. Register an account (`POST /connectors` with `secretRef`), then
   `POST /connectors/:id/test` → `{ ok: true }`.
2. `mail.search` → summaries; `mail.get_message` → body.
3. `mail.save_attachments_to_s3` → document created + (if Temporal enabled)
   processing started; repeat → `deduped: true`, no re-upload.
4. `mail.create_draft` → a draft appears in Drafts; **confirm no message is sent**.

## Residual risks

Postbox/Cloudflare read via downstream IMAP only; rate limiter is process-local;
draft idempotency relies on the broker idempotency key; OAuth2 refresh exchange is
a follow-up (app-password is the primary path); large attachments are buffered in
memory (bounded by `MAIL_MAX_ATTACHMENT_BYTES`).
