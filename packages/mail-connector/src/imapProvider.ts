/**
 * Generic IMAP mail provider (imapflow + mailparser). Read-only plus draft APPEND;
 * NO SMTP transport is ever created, so a message can never be sent. Stateless:
 * each operation opens a connection and logs out in `finally`. Throttled per
 * connection by a token bucket. Works for any IMAP mailbox — Yandex 360, a box
 * fed by Yandex Cloud Postbox / Cloudflare Email Routing, or self-hosted — with
 * differences confined to host/port/auth in the account metadata.
 */
import { ImapFlow, type FetchMessageObject, type MessageAddressObject, type MessageStructureObject, type SearchObject } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { AppError, NotFoundError, UpstreamError } from '@su10/errors';
import type {
  CreateDraftInput,
  GetAttachmentsInput,
  GetMessageInput,
  MailAttachmentBytes,
  MailAttachmentMeta,
  MailConnectionConfig,
  MailMessageFull,
  MailMessageSummary,
  MailProviderFactory,
  MailProviderPort,
  MailSearchQuery,
} from './port.js';
import { createMailRateLimiter, type MailRateLimiter, type RateLimitConfig } from './rateLimit.js';

const READ_FETCH = {
  uid: true,
  envelope: true,
  flags: true,
  size: true,
  bodyStructure: true,
} as const;

export class ImapMailProvider implements MailProviderPort {
  private readonly rateKey: string;

  constructor(
    private readonly config: MailConnectionConfig,
    private readonly limiter: MailRateLimiter,
  ) {
    this.rateKey = `${config.host}:${config.user}`;
  }

  async verify(signal?: AbortSignal): Promise<{ ok: true }> {
    return this.run(signal, async (client) => {
      await client.noop();
      return { ok: true as const };
    });
  }

  async search(query: MailSearchQuery, signal?: AbortSignal): Promise<MailMessageSummary[]> {
    const mailbox = query.mailbox ?? this.config.mailbox;
    return this.run(signal, async (client) => {
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      try {
        const criteria: SearchObject = {};
        if (query.from) criteria.from = query.from;
        if (query.to) criteria.to = query.to;
        if (query.subject) criteria.subject = query.subject;
        if (query.text) criteria.text = query.text;
        if (query.since) criteria.since = query.since;
        if (query.before) criteria.before = query.before;
        if (query.seen !== undefined) criteria.seen = query.seen;
        if (Object.keys(criteria).length === 0) criteria.all = true;

        const uids = await client.search(criteria, { uid: true });
        if (!uids || uids.length === 0) return [];
        const selected = uids.slice(-query.limit);
        const out: MailMessageSummary[] = [];
        for await (const msg of client.fetch(selected, READ_FETCH, { uid: true })) {
          out.push(toSummary(mailbox, msg));
        }
        out.sort((a, b) => Number(b.uid) - Number(a.uid));
        return out;
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(input: GetMessageInput, signal?: AbortSignal): Promise<MailMessageFull> {
    const mailbox = input.mailbox ?? this.config.mailbox;
    return this.run(signal, async (client) => {
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      try {
        const msg = await client.fetchOne(input.uid, { ...READ_FETCH, source: true }, { uid: true });
        if (!msg) throw new NotFoundError('mail message not found');
        const parsed = await simpleParser(msg.source ?? Buffer.alloc(0));
        return {
          ...toSummary(mailbox, msg),
          textBody: parsed.text ?? null,
          htmlBody: parsed.html || null,
          attachments: attachmentMeta(parsed),
        };
      } finally {
        lock.release();
      }
    });
  }

  async getAttachments(
    input: GetAttachmentsInput,
    signal?: AbortSignal,
  ): Promise<MailAttachmentBytes[]> {
    const mailbox = input.mailbox ?? this.config.mailbox;
    return this.run(signal, async (client) => {
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      try {
        const msg = await client.fetchOne(input.uid, { uid: true, source: true }, { uid: true });
        if (!msg) throw new NotFoundError('mail message not found');
        const parsed = await simpleParser(msg.source ?? Buffer.alloc(0));
        const wanted = input.attachmentIds;
        const out: MailAttachmentBytes[] = [];
        parsed.attachments.forEach((att, i) => {
          const attachmentId = String(i);
          if (wanted && !wanted.includes(attachmentId)) return;
          out.push({
            attachmentId,
            filename: att.filename ?? null,
            mimeType: att.contentType ?? null,
            sizeBytes: typeof att.size === 'number' ? att.size : att.content?.length ?? null,
            bytes: att.content ? new Uint8Array(att.content) : new Uint8Array(),
          });
        });
        return out;
      } finally {
        lock.release();
      }
    });
  }

  async createDraft(
    input: CreateDraftInput,
    signal?: AbortSignal,
  ): Promise<{ draftUid: string; mailbox: string }> {
    const raw = await composeDraft(this.config.user, input);
    return this.run(signal, async (client) => {
      const res = await client.append(this.config.draftsMailbox, raw, ['\\Draft']);
      if (!res) throw new UpstreamError('failed to append draft');
      return {
        draftUid: res.uid !== undefined ? String(res.uid) : '',
        mailbox: this.config.draftsMailbox,
      };
    });
  }

  /** Connect → run → logout (best-effort). Honors the broker abort signal. */
  private async run<T>(
    signal: AbortSignal | undefined,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) throw new UpstreamError('mail operation aborted');
    this.limiter.acquire(this.rateKey);
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth:
        this.config.authType === 'oauth2'
          ? { user: this.config.user, accessToken: this.config.secret }
          : { user: this.config.user, pass: this.config.secret },
      // Never log mail traffic / credentials.
      logger: false,
    });
    const onAbort = (): void => {
      client.close();
    };
    signal?.addEventListener('abort', onAbort);
    try {
      await client.connect();
      return await fn(client);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new UpstreamError('mail provider operation failed');
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try {
        await client.logout();
      } catch {
        /* best-effort close */
      }
    }
  }
}

function toSummary(mailbox: string, msg: FetchMessageObject): MailMessageSummary {
  const env = msg.envelope;
  return {
    uid: String(msg.uid),
    mailbox,
    subject: env?.subject ?? null,
    from: addressText(env?.from),
    to: (env?.to ?? []).map((a) => a.address ?? '').filter((a) => a.length > 0),
    date: env?.date ? new Date(env.date).toISOString() : null,
    seen: msg.flags?.has('\\Seen') ?? false,
    hasAttachments: hasAttachments(msg.bodyStructure),
    sizeBytes: msg.size ?? null,
  };
}

function addressText(list?: MessageAddressObject[]): string | null {
  if (!list || list.length === 0) return null;
  const text = list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ''}>` : a.address ?? ''))
    .filter((s) => s.length > 0)
    .join(', ');
  return text.length > 0 ? text : null;
}

function hasAttachments(node?: MessageStructureObject): boolean {
  if (!node) return false;
  if ((node.disposition ?? '').toLowerCase() === 'attachment') return true;
  return (node.childNodes ?? []).some(hasAttachments);
}

function attachmentMeta(parsed: ParsedMail): MailAttachmentMeta[] {
  return parsed.attachments.map((att, i) => ({
    attachmentId: String(i),
    filename: att.filename ?? null,
    mimeType: att.contentType ?? null,
    sizeBytes: typeof att.size === 'number' ? att.size : att.content?.length ?? null,
  }));
}

/** Builds RFC822 bytes for a draft. Compose only — no transport, no send. */
function composeDraft(from: string, input: CreateDraftInput): Promise<Buffer> {
  const mail = new MailComposer({
    from,
    to: input.to,
    ...(input.cc ? { cc: input.cc } : {}),
    ...(input.bcc ? { bcc: input.bcc } : {}),
    subject: input.subject,
    text: input.textBody,
    ...(input.htmlBody ? { html: input.htmlBody } : {}),
    ...(input.inReplyToUid ? { inReplyTo: input.inReplyToUid } : {}),
  });
  return new Promise<Buffer>((resolve, reject) => {
    mail.compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}

export interface ImapMailProviderFactoryOptions {
  rateLimit: RateLimitConfig;
  /** Injectable clock for deterministic rate-limit tests. */
  now?: () => number;
}

export function createImapMailProviderFactory(
  opts: ImapMailProviderFactoryOptions,
): MailProviderFactory {
  const limiter = createMailRateLimiter(opts.rateLimit, opts.now);
  return {
    forConnection(config: MailConnectionConfig): MailProviderPort {
      return new ImapMailProvider(config, limiter);
    },
  };
}
