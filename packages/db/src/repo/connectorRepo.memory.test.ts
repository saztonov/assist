import { describe, it, expect } from 'vitest';
import {
  InMemoryConnectorRepo,
  canUseConnector,
  assertNoSecretLikeKeys,
  MailConnectorMetadataSchema,
  type ConnectorAccountRow,
  type ConnectorPermissionRow,
} from './connectorRepo.js';

const account = (over: Partial<ConnectorAccountRow> = {}): ConnectorAccountRow => ({
  id: 'conn-1',
  providerId: null,
  connectorKey: 'mail',
  displayName: 'Mailbox',
  ownerUserId: 'u-1',
  secretRef: 'env:MAIL_TEST_APP_PASSWORD',
  status: 'inactive',
  enabled: false,
  metadataJson: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

const perm = (over: Partial<ConnectorPermissionRow>): ConnectorPermissionRow => ({
  id: 'perm-1',
  connectorAccountId: 'conn-1',
  principalType: 'user',
  principalId: 'u-2',
  permission: 'use',
  createdAt: new Date(0),
  ...over,
});

describe('canUseConnector', () => {
  it('grants the owner', () => {
    expect(canUseConnector({ id: 'u-1', roles: [] }, account(), [])).toBe(true);
  });
  it('grants admin regardless of ownership', () => {
    expect(canUseConnector({ id: 'x', roles: ['admin'] }, account(), [])).toBe(true);
  });
  it('denies a stranger with no permission', () => {
    expect(canUseConnector({ id: 'u-2', roles: [] }, account(), [])).toBe(false);
  });
  it('grants via a user permission', () => {
    expect(
      canUseConnector({ id: 'u-2', roles: [] }, account(), [perm({ principalType: 'user', principalId: 'u-2' })]),
    ).toBe(true);
  });
  it('grants via a role/group permission matched against roles', () => {
    expect(
      canUseConnector({ id: 'u-2', roles: ['finance'] }, account(), [
        perm({ principalType: 'role', principalId: 'finance' }),
      ]),
    ).toBe(true);
    expect(
      canUseConnector({ id: 'u-2', roles: ['grp-a'] }, account(), [
        perm({ principalType: 'group', principalId: 'grp-a' }),
      ]),
    ).toBe(true);
  });
  it('ignores permissions belonging to another account', () => {
    expect(
      canUseConnector({ id: 'u-2', roles: [] }, account(), [
        perm({ connectorAccountId: 'other', principalType: 'user', principalId: 'u-2' }),
      ]),
    ).toBe(false);
  });
});

describe('InMemoryConnectorRepo.listForPrincipal', () => {
  it('returns only owned/permitted accounts; admin sees all', async () => {
    const repo = new InMemoryConnectorRepo();
    const a1 = await repo.createAccount({ connectorKey: 'mail', ownerUserId: 'u-1' });
    const a2 = await repo.createAccount({
      connectorKey: 'mail',
      ownerUserId: 'u-9',
      permissions: [{ principalType: 'user', principalId: 'u-1' }],
    });
    await repo.createAccount({ connectorKey: 'mail', ownerUserId: 'u-9' });

    const mine = await repo.listForPrincipal({ id: 'u-1', roles: [] });
    expect(mine.map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort());

    const stranger = await repo.listForPrincipal({ id: 'u-7', roles: [] });
    expect(stranger).toHaveLength(0);

    const admin = await repo.listForPrincipal({ id: 'x', roles: ['admin'] });
    expect(admin).toHaveLength(3);
  });

  it('filters by connectorKey and enabledOnly', async () => {
    const repo = new InMemoryConnectorRepo();
    await repo.createAccount({ connectorKey: 'mail', ownerUserId: 'u-1', enabled: true });
    await repo.createAccount({ connectorKey: 'mail', ownerUserId: 'u-1', enabled: false });
    expect(await repo.listForPrincipal({ id: 'u-1', roles: [] }, { enabledOnly: true })).toHaveLength(1);
    expect(
      await repo.listForPrincipal({ id: 'u-1', roles: [] }, { connectorKey: 'slack' }),
    ).toHaveLength(0);
  });
});

describe('InMemoryConnectorRepo accounts/tokens (secret_ref only)', () => {
  it('stores secret_ref and never raw secret; token metadata has no value', async () => {
    const repo = new InMemoryConnectorRepo();
    const a = await repo.createAccount({
      connectorKey: 'mail',
      ownerUserId: 'u-1',
      secretRef: 'env:MAIL_TEST_APP_PASSWORD',
      metadata: { host: 'imap.yandex.ru', port: 993 },
    });
    expect(a.secretRef).toBe('env:MAIL_TEST_APP_PASSWORD');
    const tok = await repo.addTokenMetadata({
      connectorAccountId: a.id,
      tokenType: 'refresh',
      secretRef: 'env:MAIL_TEST_REFRESH',
    });
    expect(tok.secretRef).toBe('env:MAIL_TEST_REFRESH');
    expect(Object.values(tok)).not.toContain('the-actual-token');
    expect(await repo.listTokenMetadata(a.id)).toHaveLength(1);
  });

  it('setStatus updates status; missing id returns undefined', async () => {
    const repo = new InMemoryConnectorRepo();
    const a = await repo.createAccount({ connectorKey: 'mail', ownerUserId: 'u-1' });
    expect((await repo.setStatus(a.id, 'active'))?.status).toBe('active');
    expect(await repo.setStatus('nope', 'active')).toBeUndefined();
  });

  it('rejects secret-like metadata keys on create', async () => {
    const repo = new InMemoryConnectorRepo();
    await expect(
      repo.createAccount({
        connectorKey: 'mail',
        ownerUserId: 'u-1',
        metadata: { host: 'imap.yandex.ru', password: 'leak' },
      }),
    ).rejects.toThrow(/secret-like/);
  });
});

describe('assertNoSecretLikeKeys', () => {
  it('passes clean metadata and rejects secret-like keys', () => {
    expect(() => assertNoSecretLikeKeys({ host: 'h', port: 993, mailbox: 'INBOX' })).not.toThrow();
    for (const k of ['password', 'apiKey', 'api_key', 'token', 'secret', 'authorization', 'bearer']) {
      expect(() => assertNoSecretLikeKeys({ [k]: 'x' })).toThrow();
    }
  });
});

describe('MailConnectorMetadataSchema', () => {
  it('applies defaults and parses a minimal config', () => {
    const meta = MailConnectorMetadataSchema.parse({ host: 'imap.yandex.ru', user: 'me@yandex.ru' });
    expect(meta).toMatchObject({
      providerKind: 'generic-imap',
      port: 993,
      secure: true,
      mailbox: 'INBOX',
      draftsMailbox: 'Drafts',
      authType: 'password',
    });
  });

  it('rejects unknown (incl. secret-like) keys via .strict()', () => {
    expect(() =>
      MailConnectorMetadataSchema.parse({ host: 'h', user: 'u', password: 'leak' }),
    ).toThrow();
  });

  it('requires host and user', () => {
    expect(() => MailConnectorMetadataSchema.parse({ host: 'h' })).toThrow();
    expect(() => MailConnectorMetadataSchema.parse({ user: 'u' })).toThrow();
  });
});
