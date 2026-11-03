import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../services/auth/auth.service';

export function registerApiKeyRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  authPreHandler: any
): void {
  // POST /api/v1/api-keys -> 201 Created
  fastify.post(
    '/api/v1/api-keys',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = (request.body || {}) as { name?: string; expiresAt?: string };

      if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'name is required for API key',
            requestId: request.id,
          },
        });
        return;
      }

      let expiresDate: Date | null = null;
      if (body.expiresAt) {
        expiresDate = new Date(body.expiresAt);
        if (isNaN(expiresDate.getTime())) {
          reply.status(400).send({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: 'Invalid expiresAt date format',
              requestId: request.id,
            },
          });
          return;
        }
      }

      const created = await authService.createApiKey(tenant.id, body.name.trim(), expiresDate);

      reply.status(201).send({
        success: true,
        data: {
          id: created.id,
          name: created.name,
          key: created.key,
          keyPrefix: created.keyPrefix,
          createdAt: created.createdAt.toISOString(),
          expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
        },
      });
    }
  );

  // GET /api/v1/api-keys -> 200 OK
  fastify.get(
    '/api/v1/api-keys',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const keys = await authService.listApiKeys(tenant.id);

      reply.status(200).send({
        success: true,
        data: keys.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          status: k.status,
          createdAt: k.createdAt.toISOString(),
          expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        })),
      });
    }
  );

  // DELETE /api/v1/api-keys/:keyId -> 204 No Content
  fastify.delete(
    '/api/v1/api-keys/:keyId',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { keyId: string };

      const revoked = await authService.revokeApiKey(tenant.id, params.keyId);
      if (!revoked) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'API Key not found',
            requestId: request.id,
          },
        });
        return;
      }

      reply.status(204).send();
    }
  );
}
