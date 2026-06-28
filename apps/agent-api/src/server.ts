/**
 * Runtime entrypoint. Loads config, builds the app, listens, and shuts down
 * gracefully on SIGTERM/SIGINT. Local-first: OIDC uses an injected dev JWKS when
 * OIDC_DEV_JWKS is set, so protected routes work without a live Keycloak.
 */
import {
  createAgentTaskRepo,
  createDb,
  createDbAuditSink,
  createDbLlmCallRecorder,
  createDocumentRepo,
  createProviderRepo,
  createRagQueryRepo,
  closeDb,
  pingDatabase,
  type Database,
} from '@su10/db';
import { createS3Client, createS3DocumentStorage } from '@su10/s3';
import {
  createLlmGateway,
  createMockEmbeddingProvider,
  type EmbeddingProvider,
  type LlmGatewayService,
} from '@su10/llm';
import { createPgRagRepository, createRagService, ragSearchTool } from '@su10/rag';
import type { AuditSink } from '@su10/audit';
import { createLogger, type Logger } from '@su10/logger';
import { createOidc, type OidcConfig, type OidcVerifier } from '@su10/oidc';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import {
  createDbBaseToolDeps,
  createInMemoryBaseToolDeps,
  registerBaseTools,
} from '@su10/tool-base';
import type { TemporalPort } from '@su10/workflow-engine';
import { buildApp } from './app.js';
import type { DocumentsDeps, DocumentProcessingPort } from './documents/routes.js';
import { loadAgentApiConfig, type AgentApiConfig } from './config.js';
import { createStubTemporalPort } from './temporal/stubTemporalPort.js';
import { createTemporalClientPort } from './temporal/temporalClientPort.js';
import {
  dbHealthCheck,
  jwksHealthCheck,
  lmStudioHealthCheck,
  type HealthCheck,
} from './plugins/health.js';

function buildOidcVerifier(config: AgentApiConfig): OidcVerifier {
  const base: OidcConfig = {
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    clientId: config.oidc.clientId,
    resourceClient: config.oidc.resourceClient,
    clockToleranceSec: config.oidc.clockToleranceSec,
  };
  if (config.oidc.devJwks) {
    return createOidc({ ...base, jwks: JSON.parse(config.oidc.devJwks) as OidcConfig['jwks'] });
  }
  return createOidc({ ...base, jwksUri: config.oidc.jwksUri });
}

function buildHealthChecks(config: AgentApiConfig, db: Database): HealthCheck[] {
  const checks: HealthCheck[] = [];
  if (config.oidc.jwksUri) checks.push(jwksHealthCheck(config.oidc.jwksUri));
  if (config.readiness.llmEnabled) {
    checks.push(
      lmStudioHealthCheck(config.server.LLM_STUDIO_BASE_URL, config.server.LLM_STUDIO_API_TOKEN),
    );
  }
  if (config.readiness.dbEnabled) {
    checks.push(dbHealthCheck(() => pingDatabase(db)));
  }
  return checks;
}

/**
 * Documents API deps — только при `DOCUMENTS_ENABLED` и наличии S3-настроек.
 * Конструктор S3-клиента не выполняет сетевой I/O. Presigned URL не логируются.
 */
function buildDocumentsDeps(
  config: AgentApiConfig,
  db: Database,
  auditSink: AuditSink,
  temporal: TemporalPort,
): DocumentsDeps | undefined {
  const s = config.server;
  if (
    !s.DOCUMENTS_ENABLED ||
    !s.S3_ENDPOINT ||
    !s.S3_REGION ||
    !s.S3_BUCKET ||
    !s.S3_ACCESS_KEY_ID ||
    !s.S3_SECRET_ACCESS_KEY
  ) {
    return undefined;
  }
  const client = createS3Client({
    endpoint: s.S3_ENDPOINT,
    region: s.S3_REGION,
    accessKeyId: s.S3_ACCESS_KEY_ID,
    secretAccessKey: s.S3_SECRET_ACCESS_KEY,
    forcePathStyle: s.S3_FORCE_PATH_STYLE,
  });
  const storage = createS3DocumentStorage(client, {
    bucket: s.S3_BUCKET,
    presignExpirySeconds: s.S3_PRESIGN_EXPIRY_SECONDS,
  });
  // Долгая обработка документа исполняется через Temporal workflow (этап 9 / M6).
  const documentProcessing: DocumentProcessingPort = {
    start: (input) =>
      temporal.startDocumentProcessingWorkflow({
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        taskQueue: s.TEMPORAL_TASK_QUEUE,
        subject: input.subject,
      }),
  };
  return { documentRepo: createDocumentRepo(db), storage, auditSink, documentProcessing };
}

/**
 * Temporal-порт: при `TEMPORAL_ENABLED=true` — реальный `@temporalio/client`
 * (I/O вне `buildApp`); иначе local-first stub. Реальный порт умеет `close()`.
 */
async function buildTemporalPort(
  config: AgentApiConfig,
): Promise<TemporalPort & { close?(): Promise<void> }> {
  if (config.temporal.enabled) {
    return createTemporalClientPort({
      address: config.server.TEMPORAL_ADDRESS,
      namespace: config.server.TEMPORAL_NAMESPACE,
    });
  }
  return createStubTemporalPort();
}

async function main(): Promise<void> {
  const config = loadAgentApiConfig();
  const logger: Logger = createLogger('agent-api', { level: config.server.LOG_LEVEL });

  // Единый пул соединений (I/O-точка — не в buildApp). Используется readiness,
  // репозиторием задач и audit-sink; закрывается при graceful shutdown.
  const db = createDb(config.server.DATABASE_URL);

  // Реестр инструментов (метаданные/реальные handler'ы) + sandbox-брокер для
  // admin test harness (in-memory deps, без реальных сайд-эффектов).
  const toolRegistry = new ToolRegistry();
  registerBaseTools(toolRegistry, createDbBaseToolDeps(db));
  const sandboxRegistry = new ToolRegistry();
  registerBaseTools(sandboxRegistry, createInMemoryBaseToolDeps().deps);
  const toolTestBroker = new ToolBroker(sandboxRegistry);

  const temporal = await buildTemporalPort(config);
  const auditSink = createDbAuditSink(db);
  const documents = buildDocumentsDeps(config, db, auditSink, temporal);

  // LLM gateway (единственный путь к LM Studio) + RAG-сервис. Embedding-провайдер
  // отделён от chat/vision: `mock` локально, prod-провайдер — отдельной policy.
  const embeddingProvider: EmbeddingProvider | undefined =
    config.server.EMBEDDING_PROVIDER === 'mock'
      ? createMockEmbeddingProvider({ dim: config.server.EMBEDDING_DIM as 768 | 1536 })
      : undefined;
  const llmGateway: LlmGatewayService = createLlmGateway(
    {
      baseUrl: config.server.LLM_STUDIO_BASE_URL,
      token: config.server.LLM_STUDIO_API_TOKEN,
      models: {
        chandra: config.server.CHANDRA_MODEL,
        lift: config.server.LIFT_MODEL,
        qwen: config.server.QWEN_MODEL,
      },
      defaults: {
        chat: config.server.LLM_DEFAULT_CHAT_MODEL,
        ocr: config.server.LLM_DEFAULT_OCR_MODEL,
        extraction: config.server.LLM_DEFAULT_EXTRACTION_MODEL,
      },
      concurrency: {
        chandra: config.server.LLM_MAX_PARALLEL_CHANDRA,
        lift: config.server.LLM_MAX_PARALLEL_LIFT,
        qwen: config.server.LLM_MAX_PARALLEL_QWEN,
      },
      timeoutMs: config.server.LLM_TIMEOUT_MS_DEFAULT,
      maxRetries: config.server.LLM_MAX_RETRIES,
    },
    { recorder: createDbLlmCallRecorder(db), ...(embeddingProvider ? { embeddingProvider } : {}) },
  );

  const ragService = createRagService({
    repository: createPgRagRepository(db, { embeddingDim: config.server.EMBEDDING_DIM as 768 | 1536 }),
    embedder: { embed: (texts) => llmGateway.embeddings(texts).then((r) => r.vectors) },
    queryLog: createRagQueryRepo(db),
    backend: 'pgvector',
  });
  // `rag.search` tool shares the SAME ragService as `/rag/search` (one ACL path).
  toolRegistry.register(ragSearchTool({ ragService }));

  const app = await buildApp({
    config,
    logger,
    oidc: buildOidcVerifier(config),
    healthChecks: buildHealthChecks(config, db),
    taskRepo: createAgentTaskRepo(db),
    temporal,
    auditSink,
    toolRegistry,
    toolTestBroker,
    ...(documents ? { documents } : {}),
    rag: { ragService, llm: llmGateway, auditSink },
    llmAdmin: { providerRepo: createProviderRepo(db), llm: llmGateway, auditSink },
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    app
      .close()
      .then(() => temporal.close?.())
      .then(() => closeDb(db))
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: config.server.HTTP_HOST, port: config.server.HTTP_PORT });
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('server.js') || entry.endsWith('server.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
