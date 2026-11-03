import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UserRepository } from '../repositories/user.repository';
import { EventRepository } from '../repositories/event.repository';
import { formatUser, formatEvent } from './formatters';

export function registerUserRoutes(
  fastify: FastifyInstance,
  userRepo: UserRepository,
  eventRepo: EventRepository,
  authPreHandler: any
): void {
  // GET /api/v1/users -> 200 OK
  fastify.get(
    '/api/v1/users',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as {
        search?: string;
        sessionId?: string;
        limit?: string;
        cursor?: string;
      };

      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const result = await userRepo.listByTenant(
        tenant.id,
        {
          search: query.search,
          sessionId: query.sessionId,
        },
        {
          limit,
          cursor: query.cursor,
        }
      );

      reply.status(200).send({
        success: true,
        data: result.items.map(formatUser),
        meta: result.meta,
      });
    }
  );

  // GET /api/v1/users/:userId -> 200 OK
  fastify.get(
    '/api/v1/users/:userId',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { userId: string };

      const user = await userRepo.findById(tenant.id, params.userId);
      if (!user) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
            requestId: request.id,
          },
        });
        return;
      }

      reply.status(200).send({
        success: true,
        data: formatUser(user),
      });
    }
  );

  // GET /api/v1/users/:userId/events -> 200 OK
  fastify.get(
    '/api/v1/users/:userId/events',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { userId: string };
      const query = (request.query || {}) as { limit?: string; cursor?: string };

      const user = await userRepo.findById(tenant.id, params.userId);
      if (!user) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
            requestId: request.id,
          },
        });
        return;
      }

      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const result = await eventRepo.listByUser(tenant.id, params.userId, {
        limit,
        cursor: query.cursor,
      });

      reply.status(200).send({
        success: true,
        data: result.items.map(formatEvent),
        meta: result.meta,
      });
    }
  );
}
