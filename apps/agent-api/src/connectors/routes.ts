/**
 * Connectors REST (mail connector v1). Human/admin account lifecycle — list/get
 * (owner/admin/permission ACL), register (secretRef only, never a raw secret),
 * and a connectivity test. REST does NOT execute mail tools; agents call those
 * through the Tool Broker. Registered only when mail connector deps are present.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { audit, type AuditSink } from '@su10/audit';
import { NotFoundError } from '@su10/errors';
import {
  canUseConnector,
  MailConnectorMetadataSchema,
  type ConnectorAccountRow,
  type ConnectorRepo,
  type SecretResolver,
} from '@su10/db';
import { buildMailConnectionConfig, type MailProviderFactory } from '@su10/mail-connector';
import { MAIL_ACTIONS } from '../audit/auditActions.js';
import { authOf, requireRole } from './access.js';
import {
  ConnectionCard,
  ConnectionListResponse,
  ConnectorIdParams,
  CreateConnectorBody,
  CreateConnectorResponse,
  TestConnectionResponse,
} from './dto.js';

const MAIL_CONNECTOR_KEY = 'mail';

export interface ConnectorsDeps {
  connectorRepo: ConnectorRepo;
  secretResolver: SecretResolver;
  providerFactory: MailProviderFactory;
  auditSink: AuditSink;
}

const nowIso = (): string => new Date().toISOString();

/** Safe card projection — no secretRef, host, or credentials. */
function toCard(account: ConnectorAccountRow): {
  connectorAccountId: string;
  displayName: string | null;
  providerKind: string | null;
  status: string;
  enabled: boolean;
  mailbox: string | null;
} {
  const meta = MailConnectorMetadataSchema.safeParse(account.metadataJson ?? {});
  return {
    connectorAccountId: account.id,
    displayName: account.displayName,
    providerKind: meta.success ? meta.data.providerKind : null,
    status: account.status,
    enabled: account.enabled,
    mailbox: meta.success ? meta.data.mailbox : null,
  };
}

export const connectorsRoutes: FastifyPluginAsync<ConnectorsDeps> = async (root, deps) => {
  const app = root.withTypeProvider<ZodTypeProvider>();
  const { connectorRepo, auditSink } = deps;

  // GET /connectors — list connections the caller owns or may use.
  app.get(
    '/connectors',
    {
      schema: {
        tags: ['connectors'],
        summary: 'Список доступных почтовых подключений (owner/admin/ACL, без секретов)',
        response: { 200: ConnectionListResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const accounts = await connectorRepo.listForPrincipal(
        { id: auth.sub, roles: auth.roles },
        { connectorKey: MAIL_CONNECTOR_KEY },
      );
      return { connections: accounts.map(toCard) };
    },
  );

  // GET /connectors/:id — single card (ACL-checked).
  app.get(
    '/connectors/:id',
    {
      schema: {
        tags: ['connectors'],
        summary: 'Карточка подключения (ACL-проверка, без секретов)',
        params: ConnectorIdParams,
        response: { 200: ConnectionCard },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const account = await loadUsable(deps, auth, req.params.id);
      return toCard(account);
    },
  );

  // POST /connectors — register a mail account (secretRef only, never raw secret).
  app.post(
    '/connectors',
    {
      schema: {
        tags: ['connectors'],
        summary: 'Зарегистрировать почтовое подключение (secretRef, без raw-секрета)',
        body: CreateConnectorBody,
        response: { 201: CreateConnectorResponse },
      },
    },
    async (req, reply) => {
      const auth = authOf(req);
      requireRole(auth, MAIL_ACTIONS.accountCreate);
      const b = req.body;
      // Validate + normalize connection metadata (strict schema rejects secret-like keys).
      const metadata = MailConnectorMetadataSchema.parse({
        providerKind: b.providerKind,
        host: b.host,
        port: b.port,
        secure: b.secure,
        user: b.user,
        mailbox: b.mailbox,
        draftsMailbox: b.draftsMailbox,
        authType: b.authType,
      });
      const account = await connectorRepo.createAccount({
        connectorKey: MAIL_CONNECTOR_KEY,
        ownerUserId: auth.sub,
        secretRef: b.secretRef,
        enabled: b.enabled,
        status: 'inactive',
        metadata,
        ...(b.displayName ? { displayName: b.displayName } : {}),
        ...(b.permissions ? { permissions: b.permissions } : {}),
      });
      await audit(auditSink, {
        actor: auth.sub,
        action: MAIL_ACTIONS.accountCreate,
        resource: `connector:${account.id}`,
        outcome: 'success',
        at: nowIso(),
        meta: { connectorAccountId: account.id, providerKind: metadata.providerKind },
      });
      return reply.code(201).send({ connectorAccountId: account.id, status: account.status });
    },
  );

  // POST /connectors/:id/test — connectivity check (LOGIN + NOOP). Never leaks errors.
  app.post(
    '/connectors/:id/test',
    {
      schema: {
        tags: ['connectors'],
        summary: 'Проверить соединение (verify); обновляет статус',
        params: ConnectorIdParams,
        response: { 200: TestConnectionResponse },
      },
    },
    async (req) => {
      const auth = authOf(req);
      const account = await loadUsable(deps, auth, req.params.id);
      // Config errors (bad metadata / missing secret_ref) surface as safe AppErrors.
      const config = buildMailConnectionConfig(account, deps.secretResolver);
      const provider = deps.providerFactory.forConnection(config);
      let ok = false;
      try {
        await provider.verify();
        ok = true;
      } catch {
        ok = false; // never surface the raw provider/server error
      }
      const status = ok ? 'active' : 'error';
      const updated = await connectorRepo.setStatus(account.id, status);
      await audit(auditSink, {
        actor: auth.sub,
        action: MAIL_ACTIONS.connectionTest,
        resource: `connector:${account.id}`,
        outcome: ok ? 'success' : 'failure',
        at: nowIso(),
        meta: { connectorAccountId: account.id, ok },
      });
      return { ok, status: updated?.status ?? status };
    },
  );
};

/** Loads a connector the caller may use, or 404 (no existence leak). */
async function loadUsable(
  deps: ConnectorsDeps,
  auth: { sub: string; roles: string[] },
  id: string,
): Promise<ConnectorAccountRow> {
  const account = await deps.connectorRepo.getAccount(id);
  if (!account || account.connectorKey !== MAIL_CONNECTOR_KEY) {
    throw new NotFoundError('connector not found');
  }
  const perms = await deps.connectorRepo.listPermissions(account.id);
  if (!canUseConnector({ id: auth.sub, roles: auth.roles }, account, perms)) {
    throw new NotFoundError('connector not found');
  }
  return account;
}
