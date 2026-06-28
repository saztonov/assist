import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditSink } from '@su10/audit';
import { InMemoryConnectorRepo, type SecretResolver } from '@su10/db';
import { ToolBroker, ToolRegistry, type ToolCallRecord, type ToolContext } from '@su10/tools';
import type { Subject } from '@su10/permissions';
import { registerMailReadTools } from '../registerMailTools.js';
import { createStubMailProviderFactory, StubMailProvider, type StubMessage } from '../stubProvider.js';
import { DEFAULT_MAIL_CONNECTOR_OPTIONS } from '../config.js';
import { mailSearchTool } from './search.js';
import type { MailReadToolDeps } from './deps.js';

const SECRET_REF = 'env:MAIL_TEST_APP_PASSWORD';
const secretResolver: SecretResolver = {
  resolve: (ref) => {
    if (ref === SECRET_REF) return 'app-pass';
    throw new Error(`secret not found for reference ${ref}`);
  },
  tryResolve: (ref) => (ref === SECRET_REF ? 'app-pass' : undefined),
};

const message = (over: Partial<StubMessage> = {}): StubMessage => ({
  uid: '42',
  mailbox: 'INBOX',
  subject: 'Invoice #7',
  from: 'billing@vendor.example',
  to: ['me@corp.example'],
  date: '2026-06-01T10:00:00.000Z',
  seen: false,
  hasAttachments: true,
  sizeBytes: 2048,
  textBody: 'x'.repeat(100),
  htmlBody: null,
  attachments: [{ attachmentId: '0', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3 }],
  attachmentBytes: { '0': new Uint8Array([1, 2, 3]) },
  ...over,
});

let connectorRepo: InMemoryConnectorRepo;
let stub: StubMailProvider;
let deps: MailReadToolDeps;
let accountId: string;

async function setup(messages: StubMessage[] = [message()]): Promise<void> {
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
  stub = new StubMailProvider(messages);
  deps = {
    connectorRepo,
    secretResolver,
    providerFactory: createStubMailProviderFactory(stub),
    options: DEFAULT_MAIL_CONNECTOR_OPTIONS,
  };
}

function ctxOf(subject: Subject, sink: InMemoryAuditSink): ToolContext {
  return { subject, auditSink: sink, at: '2026-06-28T00:00:00.000Z' };
}

function brokerWith(): { broker: ToolBroker; calls: ToolCallRecord[]; sink: InMemoryAuditSink } {
  const registry = new ToolRegistry();
  registerMailReadTools(registry, deps);
  const calls: ToolCallRecord[] = [];
  const broker = new ToolBroker(registry, { recorder: { record: (r) => calls.push(r) } });
  return { broker, calls, sink: new InMemoryAuditSink() };
}

beforeEach(() => setup());

describe('mail.connection.list', () => {
  it('returns only owned/permitted connections; admin sees all; no secrets/host', async () => {
    await connectorRepo.createAccount({ connectorKey: 'mail', ownerUserId: 'u-9' });
    const { broker, sink } = brokerWith();

    const owner = (await broker.invoke('mail.connection.list', {}, ctxOf({ id: 'u-1', roles: ['mail.connection.list'] }, sink))) as {
      connections: Array<Record<string, unknown>>;
    };
    expect(owner.connections).toHaveLength(1);
    expect(owner.connections[0]).toMatchObject({ connectorAccountId: accountId, providerKind: 'generic-imap', mailbox: 'INBOX' });
    expect(JSON.stringify(owner.connections)).not.toContain('app-pass');
    expect(JSON.stringify(owner.connections)).not.toContain('imap.yandex.ru');

    const stranger = (await broker.invoke('mail.connection.list', {}, ctxOf({ id: 'u-7', roles: ['mail.connection.list'] }, sink))) as {
      connections: unknown[];
    };
    expect(stranger.connections).toHaveLength(0);

    const admin = (await broker.invoke('mail.connection.list', {}, ctxOf({ id: 'x', roles: ['admin'] }, sink))) as {
      connections: unknown[];
    };
    expect(admin.connections).toHaveLength(2);
  });
});

describe('mail.search / get_message / get_attachments — ACL + role gate', () => {
  it('owner gets summaries (no bodies)', async () => {
    const { broker, sink } = brokerWith();
    const res = (await broker.invoke('mail.search', { connector_account_id: accountId, limit: 10 }, ctxOf({ id: 'u-1', roles: ['mail.search'] }, sink))) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]).not.toHaveProperty('textBody');
  });

  it('denies with AuthzError when the subject lacks the tool-name role (not admin)', async () => {
    const { broker, calls, sink } = brokerWith();
    await expect(
      broker.invoke('mail.search', { connector_account_id: accountId, limit: 10 }, ctxOf({ id: 'u-1', roles: [] }, sink)),
    ).rejects.toMatchObject({ code: 'AUTHZ_DENIED' });
    expect(calls.at(-1)).toMatchObject({ status: 'denied', redactedErrorCode: 'AUTHZ_DENIED' });
  });

  it('returns not-found when a role-holder is not owner/permitted (ACL at data boundary)', async () => {
    const { broker, sink } = brokerWith();
    await expect(
      broker.invoke('mail.search', { connector_account_id: accountId, limit: 10 }, ctxOf({ id: 'u-2', roles: ['mail.search'] }, sink)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('admin bypasses ownership', async () => {
    const { broker, sink } = brokerWith();
    const res = (await broker.invoke('mail.search', { connector_account_id: accountId, limit: 10 }, ctxOf({ id: 'x', roles: ['admin'] }, sink))) as {
      messages: unknown[];
    };
    expect(res.messages).toHaveLength(1);
  });

  it('get_message truncates bodies to the configured cap', async () => {
    await setup([message({ textBody: 'y'.repeat(5000) })]);
    deps = { ...deps, options: { ...DEFAULT_MAIL_CONNECTOR_OPTIONS, bodyMaxChars: 10 } };
    const { broker, sink } = brokerWith();
    const res = (await broker.invoke('mail.get_message', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.get_message'] }, sink))) as {
      textBody: string;
    };
    expect(res.textBody).toHaveLength(10);
  });

  it('get_attachments returns metadata only and enforces the byte cap', async () => {
    const { broker, sink } = brokerWith();
    const ok = (await broker.invoke('mail.get_attachments', { connector_account_id: accountId, uid: '42' }, ctxOf({ id: 'u-1', roles: ['mail.get_attachments'] }, sink))) as {
      attachments: Array<Record<string, unknown>>;
    };
    expect(ok.attachments[0]).not.toHaveProperty('bytes');

    await expect(
      broker.invoke(
        'mail.get_attachments',
        { connector_account_id: accountId, uid: '42', max_total_bytes: 1 },
        ctxOf({ id: 'u-1', roles: ['mail.get_attachments'] }, sink),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('audit + call-log + timeout', () => {
  it('broker records a per-call audit event and call log on success', async () => {
    const { broker, calls, sink } = brokerWith();
    await broker.invoke('mail.search', { connector_account_id: accountId, limit: 10 }, ctxOf({ id: 'u-1', roles: ['mail.search'] }, sink));
    expect(sink.events.at(-1)).toMatchObject({ action: 'mail.search', outcome: 'success', actor: 'u-1' });
    expect(calls.at(-1)).toMatchObject({ toolName: 'mail.search', status: 'success' });
    // No raw secret/body leaks into the audit meta.
    expect(JSON.stringify(sink.events)).not.toContain('app-pass');
  });

  it('aborts a hanging provider call at the tool timeout', async () => {
    const hanging = new StubMailProvider();
    hanging.search = () => new Promise(() => {});
    deps = { ...deps, providerFactory: createStubMailProviderFactory(hanging) };
    const registry = new ToolRegistry();
    registry.register({ ...mailSearchTool(deps), timeoutMs: 30 });
    const broker = new ToolBroker(registry);
    await expect(
      broker.invoke('mail.search', { connector_account_id: accountId, limit: 10 }, ctxOf({ id: 'u-1', roles: ['mail.search'] }, new InMemoryAuditSink())),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
