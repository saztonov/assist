import { describe, it, expect } from 'vitest';
import { StubMailProvider, createStubMailProviderFactory, type StubMessage } from './stubProvider.js';
import type { MailProviderPort } from './port.js';

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
  textBody: 'Please find the invoice attached.',
  htmlBody: null,
  attachments: [
    { attachmentId: '0', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
  ],
  attachmentBytes: { '0': new Uint8Array([1, 2, 3]) },
  ...over,
});

describe('StubMailProvider', () => {
  it('verify returns ok without touching mailbox contents', async () => {
    expect(await new StubMailProvider().verify()).toEqual({ ok: true });
  });

  it('search filters by mailbox/subject/seen and respects limit, returning summaries only', async () => {
    const provider = new StubMailProvider([
      message({ uid: '1', subject: 'Invoice A' }),
      message({ uid: '2', subject: 'Report B', seen: true }),
      message({ uid: '3', subject: 'Invoice C' }),
    ]);
    const all = await provider.search({ limit: 10 });
    expect(all).toHaveLength(3);
    expect(all[0]).not.toHaveProperty('textBody');

    const invoices = await provider.search({ limit: 10, subject: 'Invoice' });
    expect(invoices.map((m) => m.uid).sort()).toEqual(['1', '3']);

    const unseen = await provider.search({ limit: 10, seen: false });
    expect(unseen.every((m) => !m.seen)).toBe(true);

    expect(await provider.search({ limit: 1 })).toHaveLength(1);
  });

  it('getMessage returns full body + attachment metadata', async () => {
    const provider = new StubMailProvider([message()]);
    const msg = await provider.getMessage({ uid: '42' });
    expect(msg.textBody).toContain('invoice');
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].attachmentId).toBe('0');
  });

  it('getMessage throws NotFound for an unknown uid', async () => {
    const provider = new StubMailProvider([message()]);
    await expect(provider.getMessage({ uid: '999' })).rejects.toThrow(/not found/i);
  });

  it('getAttachments returns bytes, filtered by attachmentIds', async () => {
    const provider = new StubMailProvider([
      message({
        attachments: [
          { attachmentId: '0', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3 },
          { attachmentId: '1', filename: 'b.csv', mimeType: 'text/csv', sizeBytes: 2 },
        ],
        attachmentBytes: { '0': new Uint8Array([1, 2, 3]), '1': new Uint8Array([9, 9]) },
      }),
    ]);
    const all = await provider.getAttachments({ uid: '42' });
    expect(all).toHaveLength(2);
    const one = await provider.getAttachments({ uid: '42', attachmentIds: ['1'] });
    expect(one).toHaveLength(1);
    expect(Array.from(one[0].bytes)).toEqual([9, 9]);
  });

  it('createDraft records a deterministic draft and never sends', async () => {
    const provider = new StubMailProvider();
    const res = await provider.createDraft({
      subject: 'Re: Invoice',
      to: ['billing@vendor.example'],
      textBody: 'Thanks',
    });
    expect(res).toEqual({ draftUid: 'draft-1', mailbox: 'Drafts' });
    expect(provider.drafts).toHaveLength(1);
  });

  it('exposes no send capability (contract: drafts only)', () => {
    const provider: MailProviderPort = new StubMailProvider();
    expect((provider as Record<string, unknown>).send).toBeUndefined();
    expect((provider as Record<string, unknown>).sendMail).toBeUndefined();
    expect((provider as Record<string, unknown>).sendMessage).toBeUndefined();
  });
});

describe('createStubMailProviderFactory', () => {
  it('returns the same provider for any connection', () => {
    const provider = new StubMailProvider();
    const factory = createStubMailProviderFactory(provider);
    const cfg = {
      host: 'imap.yandex.ru',
      port: 993,
      secure: true,
      user: 'u',
      authType: 'password' as const,
      secret: 'x',
      mailbox: 'INBOX',
      draftsMailbox: 'Drafts',
    };
    expect(factory.forConnection(cfg)).toBe(provider);
  });
});
