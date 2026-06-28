import { describe, it, expect } from 'vitest';
import type { ConnectorAccountRow, SecretResolver } from '@su10/db';
import { buildMailConnectionConfig, DEFAULT_MAIL_CONNECTOR_OPTIONS } from './config.js';

const account = (over: Partial<ConnectorAccountRow> = {}): ConnectorAccountRow => ({
  id: 'conn-1',
  providerId: null,
  connectorKey: 'mail',
  displayName: 'Mailbox',
  ownerUserId: 'u-1',
  secretRef: 'env:MAIL_TEST_APP_PASSWORD',
  status: 'active',
  enabled: true,
  metadataJson: { host: 'imap.yandex.ru', user: 'me@yandex.ru' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

function resolver(map: Record<string, string>): SecretResolver {
  return {
    resolve(ref: string) {
      const v = map[ref];
      if (v === undefined) throw new Error(`secret not found for reference ${ref}`);
      return v;
    },
    tryResolve(ref) {
      return ref ? map[ref] : undefined;
    },
  };
}

describe('buildMailConnectionConfig', () => {
  it('builds a config from metadata + resolved secret (defaults applied)', () => {
    const cfg = buildMailConnectionConfig(account(), resolver({ 'env:MAIL_TEST_APP_PASSWORD': 'app-pass' }));
    expect(cfg).toMatchObject({
      host: 'imap.yandex.ru',
      port: 993,
      secure: true,
      user: 'me@yandex.ru',
      authType: 'password',
      secret: 'app-pass',
      mailbox: 'INBOX',
      draftsMailbox: 'Drafts',
    });
  });

  it('throws NotFound when the account has no secret_ref', () => {
    expect(() => buildMailConnectionConfig(account({ secretRef: null }), resolver({}))).toThrow(
      /secret reference/i,
    );
  });

  it('throws Validation when metadata is invalid (missing host/user)', () => {
    expect(() =>
      buildMailConnectionConfig(account({ metadataJson: { host: 'imap.yandex.ru' } }), resolver({})),
    ).toThrow(/metadata/i);
  });

  it('rejects metadata with unknown/secret-like keys (.strict schema)', () => {
    expect(() =>
      buildMailConnectionConfig(
        account({ metadataJson: { host: 'h', user: 'u', password: 'leak' } }),
        resolver({ 'env:MAIL_TEST_APP_PASSWORD': 'app-pass' }),
      ),
    ).toThrow(/metadata/i);
  });

  it('exposes sane default options', () => {
    expect(DEFAULT_MAIL_CONNECTOR_OPTIONS.maxAttachmentBytes).toBeGreaterThan(0);
    expect(DEFAULT_MAIL_CONNECTOR_OPTIONS.bodyMaxChars).toBeGreaterThan(0);
    expect(DEFAULT_MAIL_CONNECTOR_OPTIONS.rateLimit.capacity).toBeGreaterThan(0);
  });
});
