/**
 * Minimal typing for nodemailer's compose-only MailComposer (no transport, no
 * send). `@types/nodemailer` does not ship this subpath, so we declare just the
 * surface we use: build a draft's RFC822 bytes for IMAP APPEND.
 */
declare module 'nodemailer/lib/mail-composer/index.js' {
  interface MailComposerCompiled {
    build(callback: (err: Error | null, message: Buffer) => void): void;
  }
  class MailComposer {
    constructor(mail: Record<string, unknown>);
    compile(): MailComposerCompiled;
  }
  export default MailComposer;
}
