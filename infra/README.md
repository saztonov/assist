# infra/

Placeholder for the corporate **single-VPS baseline** deployment (Docker Compose
on one production VPS: nginx reverse proxy + portal containers + worker containers
+ Keycloak). This is an orientation skeleton, **NOT production-ready scripts**.

Production deployment is performed by a deploy runner / CI-CD (immutable image
build from an exact commit → push to Yandex Container Registry → apply SQL
migrations as a separate step → update compose project → health checks →
deployment report). The production VPS never runs `git pull` / `npm install` /
`npm run build`.

Migrations are SQL-first and applied as a separate deploy step (never auto-run
from app/worker containers). Secrets come from Yandex Lockbox, never from git.

See [docs/MASTER_ARCHITECTURE_CONTRACT.md](../docs/MASTER_ARCHITECTURE_CONTRACT.md)
and [docs/ARCHITECTURE_RULES.md](../docs/ARCHITECTURE_RULES.md).
