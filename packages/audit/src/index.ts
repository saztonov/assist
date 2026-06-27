/** Append-only audit events for business actions. NODE-ONLY. */
import { z } from 'zod';

export const AuditEventSchema = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  resource: z.string().optional(),
  outcome: z.enum(['allowed', 'denied', 'success', 'failure']),
  /** ISO timestamp supplied by the caller (deterministic, testable). */
  at: z.string().min(1),
  meta: z.record(z.unknown()).optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export interface AuditSink {
  write(event: AuditEvent): Promise<void> | void;
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  write(event: AuditEvent): void {
    this.events.push(event);
  }
}

export async function audit(sink: AuditSink, event: AuditEvent): Promise<void> {
  await sink.write(AuditEventSchema.parse(event));
}
