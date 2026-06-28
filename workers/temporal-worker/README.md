# @su10/temporal-worker

Хост Temporal Worker для AI/Agent Portal (этап 6).

Регистрирует детерминированные workflow из `@su10/workflow-engine/workflows`
(`generic_agent_task_workflow`, `visual_template_generic_workflow`) и инжектирует
реализации activities — **единственное место side effects**:

- `recordTaskStatus` → `agentTaskRepo.transitionStatus` (источник истины статуса);
- `runToolBlock` → `ToolBroker.invoke` (через temporal-адаптер `@su10/tools`);
- `runAgentBlock` → агентный runtime (этап 7; до него — echo);
- `createArtifact` / `requestApproval` / `notifyUser` → репозитории `@su10/db`.

## Архитектурные инварианты

- Workflow детерминированы: только `@temporalio/workflow`, без `node:*`/БД/сети.
- Side effects идемпотентны (повтор при ретрае Temporal не дублирует эффект):
  `outbox.dedupe_key`, `tool_call_logs.idempotency_key`, idempotent `recordTaskStatus`.
- Бизнес-статус — `agent_tasks.status` + `workflow_id`; LangGraph checkpoint — НЕ источник.
- В Temporal history/логи не уходят секреты/сырьё (только ids/refs/хэши/коды).

## Локальный запуск (опционально; деплой отложен)

CI и unit-тесты идут на фейках и НЕ требуют живого кластера. Для ручного smoke:

```bash
# 1) поднять локальный Temporal dev-сервер (CLI Temporal):
temporal server start-dev            # слушает localhost:7233, UI :8233

# 2) запустить worker (использует TEMPORAL_* из окружения):
pnpm --filter @su10/temporal-worker build && node workers/temporal-worker/dist/index.js

# 3) включить реальный клиент в agent-api и создать задачу:
TEMPORAL_ENABLED=true pnpm --filter @su10/agent-api dev
```

## Тесты

```bash
pnpm exec vitest run workers/temporal-worker          # offline (фейки)
RUN_TEMPORAL_IT=1 pnpm exec vitest run workers/temporal-worker  # + @temporalio/testing IT
```

`workflows.it.test.ts` (TestWorkflowEnvironment) по умолчанию пропускается
(`RUN_TEMPORAL_IT` не задан), чтобы offline-CI оставался зелёным.
