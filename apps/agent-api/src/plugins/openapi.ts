/**
 * OpenAPI 3.1 generation from zod route schemas (fastify-type-provider-zod).
 * Serves the spec at /openapi.json (public); the Swagger UI at /docs is gated
 * behind a config flag (off in prod). A global `bearerAuth` security scheme is
 * declared; public routes (health, openapi) are hidden via `schema.hide`.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export interface OpenApiOptions {
  uiEnabled: boolean;
  title?: string;
  version?: string;
}

const plugin: FastifyPluginAsync<OpenApiOptions> = async (app, opts) => {
  await app.register(swagger, {
    openapi: {
      info: { title: opts.title ?? 'agent-api', version: opts.version ?? '0.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  if (opts.uiEnabled) {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }
};

export const openapiPlugin = fp(plugin, { name: 'agent-api-openapi', fastify: '5.x' });
