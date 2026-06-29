# AI Portal Web (этап 12)

Базовый портал сотрудника `apps/ai-portal-web`: layout на Ant Design 5, вход через
Keycloak (OIDC PKCE) с dev-token fallback, разделы Чат / Мои задачи / Шаблоны /
Документы / Подключения / Approvals / Артефакты / Администрирование.

Фронтенд ходит ТОЛЬКО в backend `/api/v1`. Единственное прямое browser→storage
взаимодействие — presigned PUT файла в S3 (by design).

## Контракт endpoint → раздел

| Раздел | Backend | Статус |
|---|---|---|
| Чат | `POST/GET /agent/chat/sessions`, `GET /agent/chat/sessions/:id`, `POST .../messages` | этап 12 (mock-агент, echo) |
| Мои задачи | `GET /agent/tasks`, `GET /agent/tasks/:id`, `/events`, `POST .../cancel` | этап 4 |
| Шаблоны | `GET/POST /workflow-templates`, `/draft`, `/publish`, `/test-run` | этап 11 |
| Документы | `POST /documents/upload-session` → presigned PUT → `POST /documents/:id/confirm`, `GET /documents/:id` | этап 9 (нужен S3) |
| Подключения | `GET /connectors` (read-only) | этап 10 |
| Approvals | `GET /approvals`, `GET /approvals/:id`, `POST .../approve`, `POST .../reject` | этап 12 |
| Артефакты | `GET /artifacts` (501) | заглушка «в разработке» |
| Администрирование | `GET /llm/*` (модели/провайдеры/политики) | этап 8 |

## Аутентификация

- **OIDC-режим**: задайте `VITE_OIDC_ISSUER_URL` и `VITE_OIDC_CLIENT_ID`. Используется
  Authorization Code + PKCE (`oidc-client-ts`). Access-token кладётся в не-React
  `auth/tokenStore`, откуда его берёт `api/client`. Callback `?code&state`
  обрабатывается в `AuthProvider` и очищается из URL (`history.replaceState`).
- **Dev-режим** (local-first): если `VITE_OIDC_*` не заданы — вход по dev-токену из
  `localStorage.dev_token` (получить: `pnpm --filter @su10/agent-api mint-dev-token`).

### Keycloak (prod)
- Public client (без секрета), Standard flow с PKCE.
- Valid redirect URI = `VITE_OIDC_REDIRECT_URI` (dev: `http://localhost:5173`).
- Audience mapper добавляет `agent-api` в `aud`; backend валидирует JWT по публичному JWKS.

## S3 (s3.cloud.ru)

Backend документов уже готов. Для работы загрузки задать на `agent-api`:
`DOCUMENTS_ENABLED=true`, `S3_ENDPOINT=https://s3.cloud.ru`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (из секрет-хранилища), `S3_FORCE_PATH_STYLE`
(по умолчанию false для s3.cloud.ru).

**CORS бакета (обязательно):** presigned PUT идёт из браузера, поэтому на бакете
нужно разрешить методы `PUT`/`GET` для Origin фронтенда (dev `http://localhost:5173`,
прод-домен) и заголовок `content-type`. Content-Type PUT-запроса совпадает с
`mimeType`, отправленным в `upload-session` (иначе S3 вернёт 403).

## env / secrets

Frontend (browser-safe, Vite): `VITE_API_BASE_URL`, `VITE_OIDC_ISSUER_URL`,
`VITE_OIDC_CLIENT_ID`, `VITE_OIDC_REDIRECT_URI`, `VITE_OIDC_SCOPE`.
Backend (этап 12 не вводит новых секретов сверх существующих): `OIDC_*`,
`DOCUMENTS_ENABLED`, `S3_*`. Секреты S3/Keycloak — только из секрет-хранилища, не в git.

Миграции: новых нет — chat/approvals таблицы уже в `packages/db/drizzle/0000_init.sql`.

## Локальный запуск (smoke)

1. `pnpm install`
2. Backend: задать `OIDC_DEV_JWKS` (из `mint-dev-token`), при необходимости `S3_*` +
   `DOCUMENTS_ENABLED=true`; `pnpm --filter @su10/agent-api dev` (`:8080`). Chat и
   Approvals подключены всегда (поверх БД).
3. Frontend: `pnpm --filter @su10/ai-portal-web dev` (`:5173`, прокси `/api` → `:8080`).
4. Проверить: вход (Keycloak или dev-token) → «Мои задачи» список → «Чат» отправка →
   ответ mock-агента → «Документы» загрузка (presigned PUT в S3) → «Approvals»
   approve/reject.

## Тесты / проверки

- `pnpm --filter @su10/db test` — chatRepo / approvalRepo (guarded resolve).
- `pnpm --filter @su10/agent-api test` — chat / approvals REST (ACL, 409, нет контента в audit).
- `npx vitest run apps/ai-portal-web` — auth, AppShell, страницы (jsdom + mock fetch).
- `pnpm lint`, `pnpm check:frontend-boundaries`, `pnpm --filter @su10/ai-portal-web build`.
