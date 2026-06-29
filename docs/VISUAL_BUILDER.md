# Visual Workflow Template Builder (этап 11)

Визуальный конструктор шаблонов задач в `ai-portal-web` + backend persistence/исполнение.
Frontend **сам workflow не исполняет** — он собирает/валидирует/сохраняет `WorkflowTemplate`
JSON, публикует версию и запускает тест-прогон через backend.

## Поток

```
Конструктор (React Flow)
  → POST /api/v1/workflow-templates            (создать draft)
  → PUT  /api/v1/workflow-templates/:id/draft  (сохранить черновик)
  → POST /api/v1/workflow-templates/:id/publish(опубликовать версию)
  → POST /api/v1/workflow-templates/:id/test-run
        → agent_task + workflow_runs → Temporal visual_template_generic_workflow
        → фронт опрашивает GET /agent/tasks/:id (+ /events)
```

Источник истины: содержимое — `workflow_template_versions.definition_json`; статус прогона —
`agent_tasks.status` + Temporal `workflow_id`; связь — `workflow_runs`.

## Контракт схемы (`@su10/workflow-schema`)

`WorkflowTemplate { id, name, version, nodes[], edges[] }`. Узлы/рёбра получили **опциональные,
игнорируемые движком** UI-поля: `node.position {x,y}`, `node.label`, `edge.id`, `edge.label` — чтобы
раскладка React Flow переживала round-trip через backend-валидацию (jsonb, без миграции).
`validateWorkflowGraph(template)` — общий чистый валидатор графа (дубли id, висящие рёбра, self-loop,
наличие триггера, достижимость, цикл-warning), используется и фронтом, и backend.

## Семантика блоков (12)

| Блок | node.type | tool/agent |
|---|---|---|
| Manual / Schedule Trigger | `manual_trigger` / `schedule_trigger` | — (no-op) |
| Search Mail | `tool` | `mail.search` |
| Download Attachments | `tool` | `mail.save_attachments_to_s3` |
| Parse Document | `agent` | `document_extraction_agent` (требует `sourceRef`) |
| RAG Search | `tool` | `rag.search` |
| Agent: Extract / Summarize | `agent` | `document_extraction_agent` / `chat_agent` |
| Create XLSX / Report | `tool` | `artifact.create` |
| Request Approval | `approval` | approval-гейт |
| Notify User | `tool` | `notification.send` |

Каталог аугментируется живыми `GET /tools` (risk/approval/inputSchema). На **publish** и **test-run**
backend проверяет: zod-форму + `validateWorkflowGraph` + доступность `toolRef`/агента в реестре
(иначе `409`). **draft** сохраняется пермиссивно (только zod-форма).

## Backend

- `@su10/db`: `workflowTemplateRepo` (PG + `InMemoryWorkflowTemplateRepo`) над существующими
  таблицами `workflow_templates` / `_versions` / `_runs`. Модель: `status` (`draft|published`) +
  `latest_version_id`; правка после publish форкает vN+1 draft; publish идемпотентен; checksum —
  стабильный sha256 (хранится только хэш).
- `apps/agent-api/src/workflow-templates/`: `routes.ts` (6 endpoints), `dto.ts`, `access.ts`
  (владелец + admin, чужой → 404), `validation.ts`. Audit: `workflow_template.{create,save_draft,
  publish,test_run}` — только ids/счётчики, без `definition_json`/`params`.
- Исполнение: `TemporalPort.startAgentTaskWorkflow` принимает опциональный `template` → при наличии
  стартует `visual_template_generic_workflow` (с `assertNoSecretsInPayload`), иначе generic. Один
  `workflowId = agent-task-${taskId}`. `POST /agent/tasks` не изменён.

## Frontend (`apps/ai-portal-web/src/pages/builder/`)

`BuilderPage` (list ↔ editor без роутера), `TemplateListView`, `WorkflowEditor` (тулбар + палитра +
canvas + конфиг-панель), `canvas/*` (React Flow), чистые `catalog.ts` / `mapping.ts`,
`useWorkflowEditor`, `useTestRunPoller` + `TestRunDrawer`. Зависимость `@xyflow/react` (catalog).
Сеть — только через `api`-клиент (`/api/v1`); серверные пакеты не импортируются
(`check-frontend-boundaries`).

## Миграции / env / secrets

- **Миграции:** нет (переиспользованы существующие таблицы; `definition_json` — jsonb).
- **Env/secrets:** новых нет. Исполнение через `TEMPORAL_ENABLED` (локально stub).
- Секреты в `params` узлов не допускаются (только `secret_ref`); на старте visual-workflow —
  `assertNoSecretsInPayload`.

## Локальный запуск / проверки

```
pnpm install
pnpm --filter @su10/agent-api dev      # backend на :8080
pnpm --filter @su10/ai-portal-web dev  # фронт на :5173 (proxy /api → :8080)
# dev_token в localStorage → вкладка «Конструктор»
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm check:frontend-boundaries
```

## Остаточные риски

- `artifact.create` (XLSX/Report) и approval-узел на runtime исполняются ограниченно: test-run шаблона
  с ними может не дойти до конца, но сборка/сохранение/публикация валидного JSON работают.
- Parse Document — наименее строгий блок: требует валидный `sourceRef`.
- «Живой published при редактировании нового draft» не поддержан (после save-after-publish шаблон
  возвращается в draft); для одновременности понадобится `workflow_templates.published_version_id`
  (отдельная миграция) — вне объёма.
- `assertNoSecretsInPayload` — эвристика (defense-in-depth), не замена политике secret_ref.
