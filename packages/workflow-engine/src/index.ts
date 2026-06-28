/**
 * Temporal workflow engine — публичная поверхность пакета. NODE-ONLY.
 *
 * Экспортируются: порт оркестрации (`TemporalPort`), контракт activities,
 * сериализуемые контракты/константы и ЧИСТАЯ orchestration-логика (для worker и
 * offline-тестов). Сами Temporal-workflow (`workflows.ts`) СЮДА НЕ входят — их
 * грузит только worker через `workflowsPath`, чтобы consumers (agent-api) не
 * тянули `@temporalio/workflow` и сохранялся ацикличный граф зависимостей.
 *
 * Источник истины бизнес-статуса — `agent_tasks.status` + Temporal `workflow_id`;
 * смена статуса только через activity `recordTaskStatus` → `transitionStatus`.
 */
export * from './temporalPort.js';
export * from './activities.js';
// constants реэкспортируются через contracts.js (избегаем двойного `export *`).
export * from './contracts.js';
export * from './orchestration.js';
