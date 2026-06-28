/**
 * Транзакционный outbox (для базового tool notification.send). Идемпотентность —
 * `dedupe_key` UNIQUE: повтор с тем же ключом не создаёт дубль (ON CONFLICT DO NOTHING).
 */
import { outboxEvents } from '../schema/platform.js';
import type { Database } from '../index.js';

export interface EnqueueOutboxInput {
  aggregateType?: string | null;
  aggregateId?: string | null;
  eventType: string;
  dedupeKey: string;
  payload?: unknown;
}

export interface OutboxRepo {
  /** Возвращает `{enqueued:false}`, если ключ уже существовал (идемпотентно). */
  enqueue(input: EnqueueOutboxInput): Promise<{ enqueued: boolean }>;
}

export function createOutboxRepo(db: Database): OutboxRepo {
  return {
    async enqueue(input) {
      const rows = await db
        .insert(outboxEvents)
        .values({
          aggregateType: input.aggregateType ?? null,
          aggregateId: input.aggregateId ?? null,
          eventType: input.eventType,
          dedupeKey: input.dedupeKey,
          payloadJson: input.payload ?? null,
        })
        .onConflictDoNothing({ target: outboxEvents.dedupeKey })
        .returning({ id: outboxEvents.id });
      return { enqueued: rows.length > 0 };
    },
  };
}
