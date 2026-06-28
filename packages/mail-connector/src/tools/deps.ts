/**
 * Shared dependencies and helpers for the mail tools. Tools run ONLY through the
 * Tool Broker; handlers resolve the connector account, enforce object-level ACL
 * (`canUseConnector`) at the data boundary, then build a provider from the
 * account's metadata + freshly resolved secret.
 */
import { NotFoundError } from '@su10/errors';
import type { Subject } from '@su10/permissions';
import {
  canUseConnector,
  type ConnectorAccountRow,
  type ConnectorRepo,
  type DocumentRepo,
  type SecretResolver,
} from '@su10/db';
import type { DocumentStoragePort } from '@su10/s3';
import { buildMailConnectionConfig, type MailConnectorOptions } from '../config.js';
import type { MailProviderFactory, MailProviderPort } from '../port.js';

export const MAIL_CONNECTOR_KEY = 'mail';

/** Optional hook to kick off document processing (Temporal) for saved attachments. */
export interface MailDocumentProcessingPort {
  start(input: {
    documentId: string;
    documentVersionId: string;
    storageKey: string;
    subject: { id: string; roles: string[] };
  }): Promise<{ workflowId?: string } | void>;
}

export interface MailReadToolDeps {
  connectorRepo: Pick<ConnectorRepo, 'getAccount' | 'listPermissions' | 'listForPrincipal'>;
  secretResolver: SecretResolver;
  providerFactory: MailProviderFactory;
  options: MailConnectorOptions;
}

export interface MailToolDeps extends MailReadToolDeps {
  storage: DocumentStoragePort;
  documentRepo: DocumentRepo;
  documentProcessing?: MailDocumentProcessingPort;
}

/** Loads a mail connector account the subject may use, or throws not-found. */
export async function loadUsableMailAccount(
  deps: MailReadToolDeps,
  subject: Subject,
  connectorAccountId: string,
): Promise<ConnectorAccountRow> {
  const account = await deps.connectorRepo.getAccount(connectorAccountId);
  if (!account || account.connectorKey !== MAIL_CONNECTOR_KEY) {
    throw new NotFoundError('mail connection not found');
  }
  const perms = await deps.connectorRepo.listPermissions(account.id);
  if (!canUseConnector(subject, account, perms)) {
    throw new NotFoundError('mail connection not found');
  }
  return account;
}

/** Builds a provider bound to the account (resolves the secret at call time). */
export function providerForAccount(
  deps: MailReadToolDeps,
  account: ConnectorAccountRow,
): MailProviderPort {
  const config = buildMailConnectionConfig(account, deps.secretResolver);
  return deps.providerFactory.forConnection(config);
}

/** Truncates a body to the configured cap (bounds payload + hashing cost). */
export function truncateBody(value: string | null, maxChars: number): string | null {
  if (value == null) return null;
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}
