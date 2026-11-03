import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EventRepository } from '../repositories/event.repository';
import { EventType } from '@prisma/client';
import { formatEvent } from './formatters';

export function registerEventRoutes(
  fastify: FastifyInstance,
  eventRepo: EventRepository,
  authPreHandler: any
): void {
  // GET /api/v1/events -> 200 OK
  fastify.get(
    '/api/v1/events',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as {
        sessionId?: string;
        userId?: string;
        eventType?: EventType;
        from?: string;
        to?: string;
        limit?: string;
        cursor?: string;
      };

      const limit = query.limit ? parseInt(query.limit, 10) : 50;

      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (query.from) {
        fromDate = new Date(query.from);
        if (isNaN(fromDate.getTime())) {
          reply.status(400).send({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: "Invalid 'from' timestamp format",
              requestId: request.id,
            },
          });
          return;
        }
      }

      if (query.to) {
        toDate = new Date(query.to);
        if (isNaN(toDate.getTime())) {
          reply.status(400).send({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: "Invalid 'to' timestamp format",
              requestId: request.id,
            },
          });
          return;
        }
      }

      const result = await eventRepo.listByTenant(
        tenant.id,
        {
          sessionId: query.sessionId,
          userId: query.userId,
          eventType: query.eventType,
          from: fromDate,
          to: toDate,
        },
        {
          limit,
          cursor: query.cursor,
        }
      );

      reply.status(200).send({
        success: true,
        data: result.items.map(formatEvent),
        meta: result.meta,
      });
    }
  );

  // GET /api/v1/events/:eventId -> 200 OK
  fastify.get(
    '/api/v1/events/:eventId',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { eventId: string };

      const event = await eventRepo.findById(tenant.id, params.eventId);
      if (!event) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Event not found',
            requestId: request.id,
          },
        });
        return;
      }

      reply.status(200).send({
        success: true,
        data: formatEvent(event),
      });
    }
  );
}
