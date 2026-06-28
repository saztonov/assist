/**
 * Tool Registry + Tool Broker. NODE-ONLY.
 *
 * Каждый инструмент объявляет input/output schema, risk_level, permission check,
 * audit и approval policy. ToolBroker.invoke — ЕДИНСТВЕННЫЙ способ исполнить
 * инструмент; прямой вызов `handler` из агентов/воркфлоу запрещён (handler не
 * экспонируется в публичной проекции/реестре). Ядро НЕ зависит от БД —
 * DB-реализации recorder/policy и базовые инструменты живут в `@su10/tool-base`.
 */
export * from './types.js';
export * from './hash.js';
export * from './recorder.js';
export * from './registry.js';
export * from './broker.js';

// Адаптеры — все funnel'ят через broker.invoke (никакого прямого handler).
export * from './adapters/langgraph.js';
export * from './adapters/temporal.js';
export * from './adapters/visual-builder.js';
