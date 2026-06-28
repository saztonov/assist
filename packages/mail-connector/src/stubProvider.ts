/**
 * Deterministic, network-free mail provider for unit/integration tests and the
 * admin sandbox. Fixtures are supplied per instance; drafts are recorded in memory
 * (no APPEND). Used everywhere a real IMAP server would otherwise be required.
 */
import { NotFoundError } from '@su10/errors';
import type {
  CreateDraftInput,
  GetAttachmentsInput,
  GetMessageInput,
  MailAttachmentBytes,
  MailConnectionConfig,
  MailMessageFull,
  MailMessageSummary,
  MailProviderFactory,
  MailProviderPort,
  MailSearchQuery,
} from './port.js';

export interface StubMessage extends MailMessageFull {
  /** Attachment bytes keyed by `attachmentId` (parsed index as string). */
  attachmentBytes: Record<string, Uint8Array>;
}

export interface StubDraft {
  draftUid: string;
  mailbox: string;
  input: CreateDraftInput;
}

const DEFAULT_MAILBOX = 'INBOX';

export class StubMailProvider implements MailProviderPort {
  readonly drafts: StubDraft[] = [];

  constructor(private readonly messages: StubMessage[] = []) {}

  async verify(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async search(query: MailSearchQuery): Promise<MailMessageSummary[]> {
    const mailbox = query.mailbox ?? DEFAULT_MAILBOX;
    const matches = this.messages
      .filter((m) => m.mailbox === mailbox)
      .filter((m) => (query.subject ? (m.subject ?? '').includes(query.subject) : true))
      .filter((m) => (query.from ? (m.from ?? '').includes(query.from) : true))
      .filter((m) => (query.seen === undefined ? true : m.seen === query.seen))
      .slice(0, query.limit)
      .map((m) => toSummary(m));
    return matches;
  }

  async getMessage(input: GetMessageInput): Promise<MailMessageFull> {
    const msg = this.find(input.mailbox, input.uid);
    return {
      ...toSummary(msg),
      textBody: msg.textBody,
      htmlBody: msg.htmlBody,
      attachments: msg.attachments,
    };
  }

  async getAttachments(input: GetAttachmentsInput): Promise<MailAttachmentBytes[]> {
    const msg = this.find(input.mailbox, input.uid);
    const wanted = input.attachmentIds;
    return msg.attachments
      .filter((a) => (wanted ? wanted.includes(a.attachmentId) : true))
      .map((a) => ({ ...a, bytes: msg.attachmentBytes[a.attachmentId] ?? new Uint8Array() }));
  }

  async createDraft(
    input: CreateDraftInput,
  ): Promise<{ draftUid: string; mailbox: string }> {
    const draftUid = `draft-${this.drafts.length + 1}`;
    const mailbox = 'Drafts';
    this.drafts.push({ draftUid, mailbox, input });
    return { draftUid, mailbox };
  }

  private find(mailbox: string | undefined, uid: string): StubMessage {
    const box = mailbox ?? DEFAULT_MAILBOX;
    const msg = this.messages.find((m) => m.mailbox === box && m.uid === uid);
    if (!msg) throw new NotFoundError('mail message not found');
    return msg;
  }
}

function toSummary(m: MailMessageFull): MailMessageSummary {
  return {
    uid: m.uid,
    mailbox: m.mailbox,
    subject: m.subject,
    from: m.from,
    to: m.to,
    date: m.date,
    seen: m.seen,
    hasAttachments: m.attachments.length > 0,
    sizeBytes: m.sizeBytes,
  };
}

/** Factory wrapper: returns the same stub provider for every connection. */
export function createStubMailProviderFactory(provider: StubMailProvider): MailProviderFactory {
  return {
    forConnection(_config: MailConnectionConfig): MailProviderPort {
      return provider;
    },
  };
}
