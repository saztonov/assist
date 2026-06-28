/**
 * Temporal Worker host. Регистрирует детерминированные workflow (изолированный
 * бандл из `@su10/workflow-engine/workflows`) и инжектирует реализации activities —
 * единственное место side effects. NODE-ONLY. `runWorker` подключается к реальному
 * Temporal (TEMPORAL_ADDRESS) и в CI не запускается (local-first; smoke — вручную).
 */
import { createRequire } from 'node:module';
import { loadServerConfig } from '@su10/config';
import { createLogger } from '@su10/logger';
import {
  createAgentApprovalRepo,
  createAgentRunRepo,
  createAgentTaskRepo,
  createArtifactRepo,
  createDb,
  createDbAuditSink,
  createDocumentRepo,
  createOutboxRepo,
  createRagChunkRepo,
  type Database,
} from '@su10/db';
import { ToolBroker, ToolRegistry } from '@su10/tools';
import {
  createDbBaseToolDeps,
  createDbPolicyResolver,
  createDbToolCallRecorder,
  registerBaseTools,
  syncRegistryToDb,
} from '@su10/tool-base';
import { createAgentBlockRunner, createFakeLlmGateway } from '@su10/agent-worker';
import { createS3Client, createS3DocumentStorage } from '@su10/s3';
import {
  createLlmGateway,
  createMockEmbeddingProvider,
  type EmbeddingProvider,
} from '@su10/llm';
import type { DocumentWorkerDeps } from '@su10/document-worker';
import type { ServerConfig } from '@su10/config';
import { createActivities, type AgentBlockRunner } from './activities.js';
import { createDocumentActivities } from './documentActivities.js';

export * from './activities.js';
export * from './documentActivities.js';

const log = createLogger('temporal-worker');

/** Собирает зависимости document-worker pipeline для активности обработки. */
function buildDocumentWorkerDeps(config: ServerConfig, db: Database): DocumentWorkerDeps {
  const dim: 768 | 1536 = config.EMBEDDING_DIM === 1536 ? 1536 : 768;
  const embeddingProvider: EmbeddingProvider =
    config.EMBEDDING_PROVIDER === 'mock'
      ? createMockEmbeddingProvider({ dim })
      : {
          providerId: config.EMBEDDING_PROVIDER,
          model: config.EMBEDDING_MODEL,
          dim,
          async embed() {
            throw new Error('production embedding provider not configured');
          },
        };
  const gateway = createLlmGateway(
    {
      baseUrl: config.LLM_STUDIO_BASE_URL,
      token: config.LLM_STUDIO_API_TOKEN,
      models: { chandra: config.CHANDRA_MODEL, lift: config.LIFT_MODEL, qwen: config.QWEN_MODEL },
      defaults: {
        chat: config.LLM_DEFAULT_CHAT_MODEL,
        ocr: config.LLM_DEFAULT_OCR_MODEL,
        extraction: config.LLM_DEFAULT_EXTRACTION_MODEL,
      },
      concurrency: {
        chandra: config.LLM_MAX_PARALLEL_CHANDRA,
        lift: config.LLM_MAX_PARALLEL_LIFT,
        qwen: config.LLM_MAX_PARALLEL_QWEN,
      },
      timeoutMs: config.LLM_TIMEOUT_MS_DEFAULT,
      maxRetries: config.LLM_MAX_RETRIES,
    },
    { embeddingProvider },
  );
  const storage =
    config.DOCUMENTS_ENABLED &&
    config.S3_ENDPOINT &&
    config.S3_REGION &&
    config.S3_BUCKET &&
    config.S3_ACCESS_KEY_ID &&
    config.S3_SECRET_ACCESS_KEY
      ? createS3DocumentStorage(
          createS3Client({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            forcePathStyle: config.S3_FORCE_PATH_STYLE,
          }),
          { bucket: config.S3_BUCKET, presignExpirySeconds: config.S3_PRESIGN_EXPIRY_SECONDS },
        )
      : {
          async getObjectBytes(): Promise<Uint8Array> {
            throw new Error('S3 not configured');
          },
        };
  return {
    storage,
    documentRepo: createDocumentRepo(db),
    chunkRepo: createRagChunkRepo(db),
    embeddingProvider,
    ocr: gateway,
  };
}

/**
 * Запускает Temporal Worker. Реальная инфраструктура (кластер) — только на этапе
 * развёртывания; локально используется опциональный `temporal server start-dev`.
 * @param runAgentBlock — агентный runtime (этап 7); по умолчанию echo.
 */
export async function runWorker(runAgentBlock?: AgentBlockRunner): Promise<void> {
  const config = loadServerConfig();
  const db = createDb(config.DATABASE_URL);

  // Реестр инструментов + broker с DB recorder/policy (handler'ы не в БД).
  const registry = new ToolRegistry();
  registerBaseTools(registry, createDbBaseToolDeps(db));
  const toolRefs = await syncRegistryToDb(registry, db);
  const broker = new ToolBroker(registry, {
    recorder: createDbToolCallRecorder(db, { resolveTool: (n) => toolRefs.get(n) ?? undefined }),
    policyResolver: createDbPolicyResolver(db),
  });

  const auditSink = createDbAuditSink(db);
  // runAgentBlock: реальный LangGraph runtime (LLM — fake до этапа 8), пишет
  // agent_runs/agent_steps. Можно переопределить аргументом runWorker.
  const agentRunner =
    runAgentBlock ??
    createAgentBlockRunner({
      runRepo: createAgentRunRepo(db),
      broker,
      auditSink,
      llm: createFakeLlmGateway(),
    });

  const activities = {
    ...createActivities({
      taskRepo: createAgentTaskRepo(db),
      approvalRepo: createAgentApprovalRepo(db),
      artifactRepo: createArtifactRepo(db),
      outboxRepo: createOutboxRepo(db),
      broker,
      auditSink,
      runAgentBlock: agentRunner,
    }),
    // Document processing activity (этап 9 / M6) — pipeline document-worker.
    ...createDocumentActivities(buildDocumentWorkerDeps(config, db)),
  };

  // Динамический импорт @temporalio/worker: тяжёлый native-модуль нужен только в
  // runtime воркера, а не при сборке/типчеке зависящих пакетов.
  const { NativeConnection, Worker } = await import('@temporalio/worker');
  const require = createRequire(import.meta.url);
  const workflowsPath = require.resolve('@su10/workflow-engine/workflows');

  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities,
    });
    log.info(
      { taskQueue: config.TEMPORAL_TASK_QUEUE, namespace: config.TEMPORAL_NAMESPACE },
      'temporal worker started',
    );
    await worker.run();
  } finally {
    await connection.close();
  }
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('index.js') || entry.endsWith('index.ts')) {
  runWorker().catch((err) => {
    log.error({ err }, 'temporal worker crashed');
    process.exit(1);
  });
}
