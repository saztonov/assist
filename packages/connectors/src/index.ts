/** External-system adapters (mail, banking, third-party APIs). NODE-ONLY.
 *  Every connector wraps ONE external side effect and must be idempotent. */

export interface ConnectorContext {
  /** Idempotency key — the same key must never double-apply an effect. */
  idempotencyKey: string;
  actor: string;
}

export interface Connector<TInput, TOutput> {
  readonly name: string;
  invoke(input: TInput, ctx: ConnectorContext): Promise<TOutput>;
}

export function makeIdempotencyKey(parts: ReadonlyArray<string>): string {
  return parts.join(':');
}

export interface MailInput {
  to: string;
  subject: string;
  body: string;
}

/** Idempotent stub: records intent, performs no network send. */
export const mailConnector: Connector<MailInput, { delivered: boolean }> = {
  name: 'mail',
  async invoke(_input, _ctx) {
    return { delivered: false };
  },
};
