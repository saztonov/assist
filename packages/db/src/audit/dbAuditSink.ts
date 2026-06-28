/**
 * DB-backed `AuditSink` → таблица `audit_events`. Общий для agent-api и worker'ов.
 *
 * Дотягивает `correlationId`/`sourcePortal` из request-context (`@su10/logger`),
 * поэтому живёт здесь (есть и БД-доступ, и контекст). Событие приходит уже
 * провалидированным (`audit()` из `@su10/audit` парсит до вызова sink) — повторно
 * не парсим. Аудит не содержит сырья/секретов (`meta` курируется вызывающим).
 */
import { getRequestContext } from '@su10/logger';
import type { AuditEvent, AuditSink } from '@su10/audit';
import { auditEvents } from '../schema/platform.js';
import type { Database } from '../index.js';

export type AuditEventRow = typeof auditEvents.$inferInsert;

/** Чистый маппинг события + контекста в строку `audit_events` (тестируемо без БД). */
export function mapAuditEventToRow(
  event: AuditEvent,
  ctx?: { correlationId?: string; sourcePortal?: string },
): AuditEventRow {
  return {
    actor: event.actor,
    action: event.action,
    resource: event.resource ?? null,
    outcome: event.outcome,
    correlationId: ctx?.correlationId ?? null,
    sourcePortal: ctx?.sourcePortal ?? null,
    metaJson: event.meta ?? null,
    at: new Date(event.at),
  };
}

export function createDbAuditSink(db: Database): AuditSink {
  return {
    async write(event: AuditEvent): Promise<void> {
      const ctx = getRequestContext();
      await db.insert(auditEvents).values(mapAuditEventToRow(event, ctx));
    },
  };
}
