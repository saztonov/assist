/**
 * Mail provider port — the single side-effect boundary for the read-only mail
 * connector. There is intentionally NO `send` method: drafts are created via IMAP
 * APPEND only, so the connector can never auto-send a message.
 *
 * A provider instance is built PER connector account from its resolved connection
 * config (`MailConnectionConfig`). Connection LISTING is not part of this port — it
 * comes from the DB (`connectorRepo`), not from the mailbox.
 */

export interface MailConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  authType: 'password' | 'oauth2';
  /** Resolved app password OR OAuth access token. NEVER logged. */
  secret: string;
  mailbox: string;
  draftsMailbox: string;
}

export interface MailSearchQuery {
  mailbox?: string;
  from?: string;
  to?: string;
  subject?: string;
  /** ISO date (inclusive lower bound). */
  since?: string;
  /** ISO date (exclusive upper bound). */
  before?: string;
  seen?: boolean;
  text?: string;
  limit: number;
}

export interface MailMessageSummary {
  uid: string;
  mailbox: string;
  subject: string | null;
  from: string | null;
  to: string[];
  date: string | null;
  seen: boolean;
  hasAttachments: boolean;
  sizeBytes: number | null;
}

export interface MailAttachmentMeta {
  /** Stable within a message (parsed attachment index). */
  attachmentId: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface MailMessageFull extends MailMessageSummary {
  textBody: string | null;
  htmlBody: string | null;
  attachments: MailAttachmentMeta[];
}

export interface MailAttachmentBytes extends MailAttachmentMeta {
  bytes: Uint8Array;
}

export interface CreateDraftInput {
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  textBody: string;
  htmlBody?: string;
  inReplyToUid?: string;
}

export interface GetMessageInput {
  mailbox?: string;
  uid: string;
}

export interface GetAttachmentsInput {
  mailbox?: string;
  uid: string;
  attachmentIds?: string[];
}

export interface MailProviderPort {
  /** LOGIN + NOOP connectivity check. Never returns mailbox contents. */
  verify(signal?: AbortSignal): Promise<{ ok: true }>;
  search(query: MailSearchQuery, signal?: AbortSignal): Promise<MailMessageSummary[]>;
  getMessage(input: GetMessageInput, signal?: AbortSignal): Promise<MailMessageFull>;
  getAttachments(input: GetAttachmentsInput, signal?: AbortSignal): Promise<MailAttachmentBytes[]>;
  /** Appends a draft (IMAP APPEND, `\Draft` flag). NEVER sends. */
  createDraft(input: CreateDraftInput, signal?: AbortSignal): Promise<{ draftUid: string; mailbox: string }>;
}

/** Builds a `MailProviderPort` bound to one connection's resolved config. */
export interface MailProviderFactory {
  forConnection(config: MailConnectionConfig): MailProviderPort;
}
