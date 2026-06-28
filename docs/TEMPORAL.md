# Temporal + LangGraph — отклонение от single-VPS baseline

Корпоративный стандard (`single-VPS baseline`, §7) для фоновых задач предписывает
**PostgreSQL jobs + transactional outbox**. AI/Agent Portal осознанно расширяет
стандарт двумя «новыми приложениями»:

- **Temporal** как workflow engine для долгих агентных процессов
  (`workers/temporal-worker`), workflow определены в `@su10/workflow-engine`;
- **LangGraph.js** как agent runtime (`workers/agent-worker`, `@su10/agents`, этап 7).

## Сосуществование, а не замена

| Механизм | Зона ответственности |
|---|---|
| **Temporal** | долгие агентные workflow (AgentTask, visual template), approval pause/resume, retry/timeout |
| **PostgreSQL `outbox_events` / `postgres_jobs`** | transactional outbox и простые отложенные задачи (уведомления, parse jobs) |

Дублирования нет: `notification.send` ставит событие в `outbox_events`
(идемпотентно по `dedupe_key`); доставка — отдельным процессором. Temporal не
заменяет outbox, а оркестрирует бизнес-процесс поверх него.

## Источник истины статуса

`agent_tasks.status` (+ Temporal `workflow_id`) — единственный источник бизнес-статуса.
Смена статуса — только через `agentTaskRepo.transitionStatus` из activity
`recordTaskStatus`. LangGraph checkpoint и Temporal history **не** являются источником
бизнес-статуса.

## Инфраструктурная дельта (для будущего развёртывания; сейчас отложено)

- отдельная БД **`temporal_db`** (self-hosted Temporal) на том же кластере PG;
- сервис **Temporal server** + контейнер(ы) **temporal-worker** на single-VPS;
- агентные воркеры (**agent-worker**) на той же VPS;
- env: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`,
  `TEMPORAL_ENABLED` (agent-api подключает реальный клиент только при `true`).

До финального развёртывания всё работает local-first: `@temporalio/testing` +
in-memory `TemporalPort` stub; живой кластер для CI не требуется.

## Безопасность

В Temporal workflow history / `agent_steps` / `llm_calls` / логи не попадают
секреты, токены, presigned URL и сырьё/ПДн — только ids/refs/хэши/коды (redaction
в `@su10/logger`, guard `assertNoSecretsInPayload` в `@su10/workflow-engine`).
