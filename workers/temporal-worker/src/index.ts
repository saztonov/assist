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
  createOutboxRepo,
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
import { createActivities, type AgentBlockRunner } from './activities.js';

export * from './activities.js';

const log = createLogger('temporal-worker');

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

  const activities = createActivities({
    taskRepo: createAgentTaskRepo(db),
    approvalRepo: createAgentApprovalRepo(db),
    artifactRepo: createArtifactRepo(db),
    outboxRepo: createOutboxRepo(db),
    broker,
    auditSink,
    runAgentBlock: agentRunner,
  });

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
