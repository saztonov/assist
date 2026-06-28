import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditSink } from '@su10/audit';
import { InMemoryConnectorRepo, InMemoryDocumentRepo, type SecretResolver } from '@su10/db';
import { ToolBroker, ToolRegistry, type ToolContext } from '@su10/tools';
import type { Subject } from '@su10/permissions';
import type { DocumentStoragePort } from '@su10/s3';
import { registerMailTools } from '../registerMailTools.js';
import { createStubMailProviderFactory, StubMailProvider, type StubMessage } from '../stubProvider.js';
import { DEFAULT_MAIL_CONNECTOR_OPTIONS } from '../config.js';
import type { MailDocumentProcessingPort, MailToolDeps } from './deps.js';

const SECRET_REF = 'env:MAIL_TEST_APP_PASSWORD';
const secretResolver: SecretResolver = {
  resolve: (ref) => (ref === SECRET_REF ? 'app-pass' : (() => { throw new Error('no secret'); })()),
  tryResolve: (ref) => (ref === SECRET_REF ? 'app-pass' : undefined),
};

const message = (over: Partial<StubMessage> = {}): StubMessage => ({
  uid: '42',
  mailbox: 'INBOX',
  subject: 'Invoice',
  from: 'billing@vendor.example',
  to: ['me@corp.example'],
  date: '2026-06-01T10:00:00.000Z',
  seen: false,
  hasAttachments: true,
  sizeBytes: 2048,
  textBody: 'body',
  htmlBody: null,
  attachments: [{ attachmentId: '0', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 3 }],
  attachmentBytes: { '0': new Uint8Array([1, 2, 3]) },
  ...over,
});

function fakeStorage(): { storage: DocumentStoragePort; puts: Array<{ key: string; bytes: Uint8Array }> } {
  const puts: Array<{ key: string; bytes: Uint8Array }> = [];
  return {
    puts,
    storage: {
      buildObjectKey: ({ filename, prefix }) => `documents/${prefix ?? 'x'}/${filename}`,
      presignPut: async (k) => `https://s3.local/${k}`,
      putObject: async (key, bytes) => {
        puts.push({ key, bytes });
      },
      headObject: async () => ({ size: 3 }),
      getObjectBytes: async () => new Uint8Array(),
    },
  };
}

let connectorRepo: InMemoryConnectorRepo;
let documentRepo: InMemoryDocumentRepo;
let stub: StubMailProvider;
let puts: Array<{ key: string; bytes: Uint8Array }>;
let baseDeps: Omit<MailToolDeps, 'documentProcessing'>;
let accountId: string;

async function setup(): Promise<void> {
  connectorRepo = new InMemoryConnectorRepo();
  const account = await connectorRepo.createAccount({
    connectorKey: 'mail',
    ownerUserId: 'u-1',
    secretRef: SECRET_REF,
    status: 'active',
    enabled: true,
    metadata: { host: 'imap.yandex.ru', user: 'me@yandex.ru' },
  });
  accountId = account.id;
  documentRepo = new InMemoryDocumentRepo();
  stub = new StubMailProvider([message()]);
  const fs = fakeStorage();
  puts = fs.puts;
  baseDeps = {
    connectorRepo,
    secretResolver,
    providerFactory: createStubMailProviderFactory(stub),
    options: DEFAULT_MAIL_CONNECTOR_OPTIONS,
    storage: fs.storage,
    documentRepo,
  };
}

function ctxOf(subject: Subject, sink: InMemoryAuditSink): ToolContext {
  return { subject, auditSink: sink, at: '2026-06-28T00:00:00.000Z' };
}

function brokerWith(deps: MailToolDeps): { broker: ToolBroker; sink: InMemoryAuditSink } {
  const registry = new ToolRegistry();
  registerMailTools(registry, deps);
  return { broker: new ToolBroker(registry), sink: new InMemoryAuditSink() };
}

beforeEach(() => setup());

describe('mail.save_attachments_to_s3', () => {
  it('saves an attachment as an owner-owned document (putObject once, status uploaded)', async () => {
    const { broker, sink } = brokerWith(baseDeps);
    const res = (await broker.invoke(
      'mail.save_attachments_to_s3',
      { connector_account_id: accountId, uid: '42' },
      ctxOf({ id: 'u-1', roles: ['mail.save_attachments_to_s3'] }, sink),
    )) as { saved: Array<Record<string, unknown>> };

    expect(res.saved).toHaveLength(1);
    expect(res.saved[0]).toMatchObject({ attachmentId: '0', deduped: false, status: 'uploaded' });
    expect(puts).toHaveLength(1);

    const doc = await documentRepo.getDocumentById(res.saved[0].documentId as string);
    expect(doc?.ownerUserId).toBe('u-1');
    expect(doc?.sourceObjectType).toBe('mail_attachment');
    const acl = await documentRepo.listAcl(doc!.id);
    expect(acl.some((a) => a.principalType === 'user' && a.principalId === 'u-1')).toBe(true);
  });

  it('is idempotent: a repeat save returns the same document and does not re-upload', async () => {
    const { broker, sink } = brokerWith(baseDeps);
    const first = (await broker.invoke('mail.save_attachments_to_s3', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.save_attachments_to_s3'] }, sink))) as {
      saved: Array<{ documentId: string }>;
    };
    const second = (await broker.invoke('mail.save_attachments_to_s3', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.save_attachments_to_s3'] }, sink))) as {
      saved: Array<{ documentId: string; deduped: boolean }>;
    };
    expect(second.saved[0].deduped).toBe(true);
    expect(second.saved[0].documentId).toBe(first.saved[0].documentId);
    expect(puts).toHaveLength(1);
  });

  it('triggers document processing → status indexing (spy receives ids only)', async () => {
    const started: Array<Record<string, unknown>> = [];
    const documentProcessing: MailDocumentProcessingPort = {
      start: async (i) => {
        started.push(i);
        return { workflowId: 'wf-1' };
      },
    };
    const { broker, sink } = brokerWith({ ...baseDeps, documentProcessing });
    const res = (await broker.invoke('mail.save_attachments_to_s3', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.save_attachments_to_s3'] }, sink))) as {
      saved: Array<{ status: string; documentId: string }>;
    };
    expect(res.saved[0].status).toBe('indexing');
    expect(started[0]).toMatchObject({ documentId: res.saved[0].documentId });
    expect(JSON.stringify(started)).not.toContain('app-pass');
  });

  it('marks failed without losing the document when processing start throws', async () => {
    const documentProcessing: MailDocumentProcessingPort = {
      start: async () => {
        throw new Error('temporal down');
      },
    };
    const { broker, sink } = brokerWith({ ...baseDeps, documentProcessing });
    const res = (await broker.invoke('mail.save_attachments_to_s3', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.save_attachments_to_s3'] }, sink))) as {
      saved: Array<{ status: string }>;
    };
    expect(res.saved[0].status).toBe('failed');
    expect(puts).toHaveLength(1);
  });

  it('rejects when attachments exceed the byte cap', async () => {
    const deps = { ...baseDeps, options: { ...DEFAULT_MAIL_CONNECTOR_OPTIONS, maxAttachmentBytes: 1 } };
    const { broker, sink } = brokerWith(deps);
    await expect(
      broker.invoke('mail.save_attachments_to_s3', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.save_attachments_to_s3'] }, sink)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('writes a domain audit event with ids only — no bytes or secrets', async () => {
    const { broker, sink } = brokerWith(baseDeps);
    await broker.invoke('mail.save_attachments_to_s3', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.save_attachments_to_s3'] }, sink));
    const domain = sink.events.find((e) => e.action === 'mail.save_attachments_to_s3');
    expect(domain).toMatchObject({ resource: `connector:${accountId}`, outcome: 'success' });
    expect(domain?.meta).toMatchObject({ savedCount: 1, deduped: false });
    expect(JSON.stringify(sink.events)).not.toContain('app-pass');
  });
});

describe('mail.create_draft', () => {
  it('appends a draft and never sends; audit carries no recipient address', async () => {
    const { broker, sink } = brokerWith(baseDeps);
    const res = (await broker.invoke(
      'mail.create_draft',
      { connector_account_id: accountId, subject: 'Re: Invoice', to: ['billing@vendor.example'], text_body: 'Thanks' },
      ctxOf({ id: 'u-1', roles: ['mail.create_draft'] }, sink),
    )) as { draftUid: string; mailbox: string };

    expect(res).toEqual({ draftUid: 'draft-1', mailbox: 'Drafts' });
    expect(stub.drafts).toHaveLength(1);

    const domain = sink.events.find((e) => e.action === 'mail.create_draft');
    expect(domain?.meta).toMatchObject({ recipientsCount: 1, deduped: false });
    // No recipient address or body leaks into the audit.
    expect(JSON.stringify(sink.events)).not.toContain('billing@vendor.example');
    expect(JSON.stringify(sink.events)).not.toContain('Thanks');
  });

  it('rejects an invalid recipient (zod email)', async () => {
    const { broker, sink } = brokerWith(baseDeps);
    await expect(
      broker.invoke('mail.create_draft', { connector_account_id: accountId, subject: 's', to: ['not-an-email'], text_body: 'x' }, ctxOf({ id: 'u-1', roles: ['mail.create_draft'] }, sink)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('denies a subject lacking the tool-name role', async () => {
    const { broker, sink } = brokerWith(baseDeps);
    await expect(
      broker.invoke('mail.create_draft', { connector_account_id: accountId, subject: 's', to: ['a@b.co'], text_body: 'x' }, ctxOf({ id: 'u-1', roles: [] }, sink)),
    ).rejects.toMatchObject({ code: 'AUTHZ_DENIED' });
  });
});
