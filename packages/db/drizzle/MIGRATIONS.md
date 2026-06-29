# Миграции `agent_platform_db`

Версионные SQL-миграции для отдельной БД портала `agent_platform_db` (Yandex Managed PostgreSQL).
Drizzle-схема (`packages/db/src/schema/*`) — источник истины для **public** app-таблиц;
raw SQL в этом каталоге — источник истины для возможностей, которые Drizzle не покрывает
(схема `rag`, `pgvector`, FTS/`tsvector`, generated columns, HNSW, trigram-индексы).

## Политика миграций (контракт I8)

- **SQL-first.** `drizzle-kit generate`/`push` НЕ используются. Файлы пишутся и ведутся вручную.
- Миграции применяются **отдельным deploy-шагом**, никогда не из app/worker-контейнеров.
- **Runtime-роль БД не имеет DDL-прав.** DDL выполняет отдельная migration-роль
  (`MIGRATION_DATABASE_URL`), runtime — только DML (`DATABASE_URL`).
- Локальные тесты **DB-free**: отсутствие кластера/расширений не ломает build/typecheck/lint/vitest.

## Baseline-правило (этап 3)

`0000_init.sql` **переписан** в чистый baseline (консолидация), потому что:

- ни одна миграция не применялась к реальной/общей БД (local-first, деплоя не было);
- каталог `drizzle/` не содержит `meta/`-снапшота (drizzle-kit не используется);
- scaffold-таблицы (`audit_log`, `documents.embedding/acl_tag`) не использовались
  кодом за пределами `packages/db` (проверено `rg`).

> ВАЖНО: если когда-либо `0000_init.sql` будет применён к общей БД — переписывать его
> запрещено; новые изменения оформляются **additive**-миграциями (`0007_*` и далее).

### Жизненный цикл `agent_tasks.status` (этап 4)

`agent_tasks.status` имеет DEFAULT `'created'` и `CHECK (status IN (...))` на 7 контрактных
статусов (`created`, `queued`, `running`, `waiting_for_approval`, `completed`, `failed`,
`cancelled`). Это правка baseline `0000_init.sql` (деплоя не было — допустимо по baseline-правилу).
CHECK — defense in depth к app-уровневому статус-автомату (`@su10/db` `domain/agentTaskStatus`);
смена статуса в runtime идёт только через `agentTaskRepo.transitionStatus`.

## Prerequisites расширений (admin/operator step)

Runtime-роль **не может** создавать расширения. На Yandex Managed PostgreSQL это отдельный
admin-шаг до применения `0005_rag.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector: тип vector(N), операторы <=> и т.д.
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- триграммные GIN-индексы по тексту/номерам
```

Проверка наличия:

```sql
SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm');
```

`gen_random_uuid()` встроена в PostgreSQL 13+ (расширение `pgcrypto` не требуется).

## Состав миграций

| Файл | Содержимое | tx |
|---|---|---|
| `0000_init.sql` | agent_tasks(+events/artifacts), chat, workflow(+versions/runs), approvals(+events), agent_runs(+steps) | да |
| `0001_documents.sql` | documents, document_versions, document_acl, document_parse_jobs | да |
| `0002_providers.sql` | llm_provider_registry/models, provider_policies, provider_usage/health_events, external_saas_providers, llm_calls | да |
| `0003_tools_mcp_connectors.sql` | tool_*, mcp_*, connector_* | да |
| `0004_platform.sql` | audit_events, outbox_events, postgres_jobs, rag_indexes, rag_queries | да |
| `0005_rag.sql` | `CREATE SCHEMA rag`; corpus_chunks(+generated tsvector), corpus_embeddings_768/_1536, index_runs, eval_feedback, индексы | да |
| `0006_rag_hnsw.no-tx.sql` | HNSW-индексы (`CREATE INDEX CONCURRENTLY`) — по одному на каждую таблицу эмбеддингов | **нет** |
| `0007_mcp_registry.sql` | additive: mcp_servers (+tools_snapshot_hash/_at), mcp_server_health_checks | да |

`0006_rag_hnsw.no-tx.sql` — **опциональный/отложенный**: `CREATE INDEX CONCURRENTLY` нельзя
выполнять внутри транзакции; точный векторный поиск работает и без HNSW. Для локальных
unit-тестов не требуется. Применять отдельным шагом, НЕ в составе транзакционного батча.

## Размерность эмбеддингов

Размерность фиксируется выбором embedding-провайдера и задаётся миграцией:

- Yandex Embeddings → `vector(768)` (`rag.corpus_embeddings_768`);
- прочие эмбеддеры → `vector(1536)` (`rag.corpus_embeddings_1536`).

Смена/добавление размерности = **новая таблица + миграция** (нельзя менять `vector(N)`
существующей колонки без пересборки). `embedding_dim` хранится колонкой с CHECK как guard.

## Forward / rollback

Forward: применять файлы по возрастанию номера. Rollback (полный откат этапа 3):

```sql
DROP SCHEMA IF EXISTS rag CASCADE;   -- сносит всю изолированную RAG-схему
-- public-таблицы откатываются DROP TABLE в обратном FK-порядке (см. заголовок каждого файла)
```

Подробные forward/rollback-заметки — в шапке каждого `*.sql`.

## Высокая стоимость изменений (change-cost)

- `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('russian', ...)) STORED`:
  смена языка конфигурации = **rewrite таблицы**. Зафиксирован `russian` (русскоязычный домен).
- `vector(N)` фиксирован миграцией; смена размерности = новая таблица + переэмбеддинг.
