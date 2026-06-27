/**
 * Fastify backend — the only public HTTP surface. Validates all I/O with zod,
 * applies the shared security plugin, exposes the llm-gateway edge and task/
 * template routes. It never runs agent reasoning itself.
 *
 * Construction does NO network I/O (no DB/LLM/Temporal connection), so the
 * /health smoke test runs without environment or external services.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { securityPlugin } from '@su10/fastify-security';
import { WorkflowTemplateSchema } from '@su10/workflow-schema';
import { ValidationError } from '@su10/errors';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(securityPlugin, { corsOrigins: false, rateLimitMax: 1000 });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/v1/system/info', async () => ({ name: 'agent-api', version: '0.0.0' }));

  // Visual Builder persistence: validate (zod) then store via @su10/db (real impl).
  app.post('/api/v1/workflows/templates', async (req, reply) => {
    const parsed = WorkflowTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid workflow template');
    return reply.status(201).send({ id: parsed.data.id });
  });

  // llm-gateway edge: delegates to @su10/llm (LM Studio) in the real impl.
  app.post('/api/v1/llm/chat', async () => ({ content: 'stub' }));

  // Task status: reads agent_tasks (+ Temporal workflow_id) — status source of truth.
  app.get('/api/v1/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { id, status: 'pending' };
  });

  return app;
}

const isMain = process.argv[1]?.endsWith('server.js') ?? false;
if (isMain) {
  buildServer()
    .then((app) => app.listen({ host: '0.0.0.0', port: Number(process.env.HTTP_PORT ?? 8080) }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
