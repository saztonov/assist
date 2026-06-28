/**
 * Connector account repository. NODE-ONLY.
 *
 * Backs the Connector Registry (accounts + permissions + token metadata). Stores
 * ONLY `secret_ref` references and non-secret `metadata_json` — never raw
 * credentials/tokens. Object-level access (`canUseConnector`) is the data-boundary
 * authorization for connector tools and the `/connectors` REST surface.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ValidationError } from '@su10/errors';
import {
  connectorAccounts,
  connectorPermissions,
  connectorTokensMetadata,
} from '../schema/connectors.js';
import type { Database } from '../index.js';

export type ConnectorAccountRow = typeof connectorAccounts.$inferSelect;
export type ConnectorPermissionRow = typeof connectorPermissions.$inferSelect;
export type ConnectorTokenMetaRow = typeof connectorTokensMetadata.$inferSelect;

/** A principal making a connector request (subject from the auth layer). */
export interface ConnectorPrincipal {
  id: string;
  roles: string[];
}

export type ConnectorPrincipalType = 'user' | 'role' | 'group';

export interface ConnectorPermissionInput {
  principalType: ConnectorPrincipalType;
  principalId: string;
  permission?: string;
}

export interface CreateConnectorAccountInput {
  connectorKey: string;
  ownerUserId: string;
  providerId?: string | null;
  displayName?: string | null;
  secretRef?: string | null;
  status?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown> | null;
  permissions?: ConnectorPermissionInput[];
}

export interface AddTokenMetadataInput {
  connectorAccountId: string;
  tokenType: 'access' | 'refresh';
  secretRef: string;
  scopes?: unknown;
  expiresAt?: Date | null;
}

export interface ListForPrincipalOptions {
  connectorKey?: string;
  enabledOnly?: boolean;
}

export interface ConnectorRepo {
  getAccount(id: string): Promise<ConnectorAccountRow | undefined>;
  listPermissions(accountId: string): Promise<ConnectorPermissionRow[]>;
  listForPrincipal(
    principal: ConnectorPrincipal,
    opts?: ListForPrincipalOptions,
  ): Promise<ConnectorAccountRow[]>;
  createAccount(input: CreateConnectorAccountInput): Promise<ConnectorAccountRow>;
  setStatus(id: string, status: string): Promise<ConnectorAccountRow | undefined>;
  listTokenMetadata(accountId: string): Promise<ConnectorTokenMetaRow[]>;
  addTokenMetadata(input: AddTokenMetadataInput): Promise<ConnectorTokenMetaRow>;
}

/**
 * Mail connector account metadata (non-secret connection config). `.strict()`
 * rejects unknown keys — including any secret-like field — so credentials can
 * never live in `metadata_json` (they belong in `secret_ref` only).
 */
export const MailConnectorMetadataSchema = z
  .object({
    providerKind: z
      .enum(['yandex360', 'postbox', 'cloudflare-imap', 'generic-imap'])
      .default('generic-imap'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(993),
    secure: z.boolean().default(true),
    user: z.string().min(1),
    mailbox: z.string().min(1).default('INBOX'),
    draftsMailbox: z.string().min(1).default('Drafts'),
    authType: z.enum(['password', 'oauth2']).default('password'),
  })
  .strict();

export type MailConnectorMetadata = z.infer<typeof MailConnectorMetadataSchema>;

const SECRET_LIKE_KEY = /(password|passwd|secret|token|api[_-]?key|credential|authorization|bearer)/i;

/** Defense-in-depth: connector metadata must never carry secret-like keys. */
export function assertNoSecretLikeKeys(metadata: Record<string, unknown> | null | undefined): void {
  if (!metadata) return;
  for (const key of Object.keys(metadata)) {
    if (SECRET_LIKE_KEY.test(key)) {
      throw new ValidationError('connector metadata must not contain secret-like keys', {
        offendingKey: key,
      });
    }
  }
}

/**
 * Object-level authorization: a principal may use a connector account when it is
 * admin, the owner, or holds a matching permission (user/role/group). Roles and
 * groups are both matched against `principal.roles`.
 */
export function canUseConnector(
  principal: ConnectorPrincipal,
  account: ConnectorAccountRow,
  permissions: ConnectorPermissionRow[],
): boolean {
  if (principal.roles.includes('admin')) return true;
  if (account.ownerUserId && account.ownerUserId === principal.id) return true;
  return permissions.some((p) => {
    if (p.connectorAccountId !== account.id) return false;
    if (p.principalType === 'user') return p.principalId === principal.id;
    if (p.principalType === 'role' || p.principalType === 'group') {
      return principal.roles.includes(p.principalId);
    }
    return false;
  });
}

export function createConnectorRepo(db: Database): ConnectorRepo {
  return {
    async getAccount(id) {
      const [row] = await db
        .select()
        .from(connectorAccounts)
        .where(eq(connectorAccounts.id, id))
        .limit(1);
      return row;
    },

    async listPermissions(accountId) {
      return db
        .select()
        .from(connectorPermissions)
        .where(eq(connectorPermissions.connectorAccountId, accountId));
    },

    async listForPrincipal(principal, opts) {
      const conds = [];
      if (opts?.connectorKey) conds.push(eq(connectorAccounts.connectorKey, opts.connectorKey));
      if (opts?.enabledOnly) conds.push(eq(connectorAccounts.enabled, true));
      const all =
        conds.length > 0
          ? await db.select().from(connectorAccounts).where(and(...conds))
          : await db.select().from(connectorAccounts);

      if (principal.roles.includes('admin')) return all;
      const ids = all.map((a) => a.id);
      if (ids.length === 0) return [];
      const perms = await db
        .select()
        .from(connectorPermissions)
        .where(inArray(connectorPermissions.connectorAccountId, ids));
      const byAccount = new Map<string, ConnectorPermissionRow[]>();
      for (const p of perms) {
        const list = byAccount.get(p.connectorAccountId) ?? [];
        list.push(p);
        byAccount.set(p.connectorAccountId, list);
      }
      return all.filter((a) => canUseConnector(principal, a, byAccount.get(a.id) ?? []));
    },

    async createAccount(input) {
      assertNoSecretLikeKeys(input.metadata);
      return db.transaction(async (tx) => {
        const [account] = await tx
          .insert(connectorAccounts)
          .values({
            providerId: input.providerId ?? null,
            connectorKey: input.connectorKey,
            displayName: input.displayName ?? null,
            ownerUserId: input.ownerUserId,
            secretRef: input.secretRef ?? null,
            status: input.status ?? 'inactive',
            enabled: input.enabled ?? false,
            metadataJson: input.metadata ?? null,
          })
          .returning();
        if (input.permissions?.length) {
          await tx.insert(connectorPermissions).values(
            input.permissions.map((p) => ({
              connectorAccountId: account.id,
              principalType: p.principalType,
              principalId: p.principalId,
              permission: p.permission ?? 'use',
            })),
          );
        }
        return account;
      });
    },

    async setStatus(id, status) {
      const [row] = await db
        .update(connectorAccounts)
        .set({ status, updatedAt: new Date() })
        .where(eq(connectorAccounts.id, id))
        .returning();
      return row;
    },

    async listTokenMetadata(accountId) {
      return db
        .select()
        .from(connectorTokensMetadata)
        .where(eq(connectorTokensMetadata.connectorAccountId, accountId));
    },

    async addTokenMetadata(input) {
      const [row] = await db
        .insert(connectorTokensMetadata)
        .values({
          connectorAccountId: input.connectorAccountId,
          tokenType: input.tokenType,
          secretRef: input.secretRef,
          scopes: input.scopes ?? null,
          expiresAt: input.expiresAt ?? null,
        })
        .returning();
      return row;
    },
  };
}

// ── In-memory implementation (tests) ─────────────────────────────────────────

export class InMemoryConnectorRepo implements ConnectorRepo {
  readonly accounts: ConnectorAccountRow[] = [];
  readonly permissions: ConnectorPermissionRow[] = [];
  readonly tokens: ConnectorTokenMetaRow[] = [];
  private clock = 0;

  // Real UUIDs so in-memory rows satisfy the tools' `.uuid()` input schemas.
  private now(): Date {
    return new Date(Date.UTC(2026, 0, 1) + this.clock++ * 1000);
  }

  private id(): string {
    return randomUUID();
  }

  async getAccount(id: string) {
    return this.accounts.find((a) => a.id === id);
  }

  async listPermissions(accountId: string) {
    return this.permissions.filter((p) => p.connectorAccountId === accountId);
  }

  async listForPrincipal(principal: ConnectorPrincipal, opts?: ListForPrincipalOptions) {
    const all = this.accounts.filter(
      (a) =>
        (!opts?.connectorKey || a.connectorKey === opts.connectorKey) &&
        (!opts?.enabledOnly || a.enabled),
    );
    if (principal.roles.includes('admin')) return all;
    return all.filter((a) =>
      canUseConnector(
        principal,
        a,
        this.permissions.filter((p) => p.connectorAccountId === a.id),
      ),
    );
  }

  async createAccount(input: CreateConnectorAccountInput) {
    assertNoSecretLikeKeys(input.metadata);
    const ts = this.now();
    const account: ConnectorAccountRow = {
      id: this.id(),
      providerId: input.providerId ?? null,
      connectorKey: input.connectorKey,
      displayName: input.displayName ?? null,
      ownerUserId: input.ownerUserId,
      secretRef: input.secretRef ?? null,
      status: input.status ?? 'inactive',
      enabled: input.enabled ?? false,
      metadataJson: input.metadata ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.accounts.push(account);
    for (const p of input.permissions ?? []) {
      this.permissions.push({
        id: this.id(),
        connectorAccountId: account.id,
        principalType: p.principalType,
        principalId: p.principalId,
        permission: p.permission ?? 'use',
        createdAt: ts,
      });
    }
    return account;
  }

  async setStatus(id: string, status: string) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) return undefined;
    account.status = status;
    account.updatedAt = this.now();
    return account;
  }

  async listTokenMetadata(accountId: string) {
    return this.tokens.filter((t) => t.connectorAccountId === accountId);
  }

  async addTokenMetadata(input: AddTokenMetadataInput) {
    const row: ConnectorTokenMetaRow = {
      id: this.id(),
      connectorAccountId: input.connectorAccountId,
      tokenType: input.tokenType,
      secretRef: input.secretRef,
      scopes: input.scopes ?? null,
      expiresAt: input.expiresAt ?? null,
      lastRotatedAt: null,
      createdAt: this.now(),
    };
    this.tokens.push(row);
    return row;
  }
}
