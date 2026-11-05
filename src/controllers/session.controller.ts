import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SessionService } from '../services/session/session.service';
import { SessionStatus } from '@prisma/client';
import { formatSession } from './formatters';

export function registerSessionRoutes(
  fastify: FastifyInstance,
  sessionService: SessionService,
  authPreHandler: any
): void {
  // POST /api/v1/live/sessions -> 202 Accepted
  fastify.post(
    '/api/v1/live/sessions',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = (request.body || {}) as {
        creatorUsername?: string;
        reconnect?: boolean;
        mode?: 'mock' | 'live';
        mockTickerIntervalMs?: number;
      };

      if (!body.creatorUsername) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'creatorUsername is required',
            requestId: request.id,
          },
        });
        return;
      }

      const session = await sessionService.createSession(tenant.id, {
        creatorUsername: body.creatorUsername,
        reconnect: body.reconnect ?? true,
        mode: body.mode,
        mockTickerIntervalMs: body.mockTickerIntervalMs,
      });

      reply.status(202).send({
        success: true,
        data: formatSession(session),
      });
    }
  );

  // GET /api/v1/live/sessions -> 200 OK
  fastify.get(
    '/api/v1/live/sessions',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as {
        status?: SessionStatus;
        limit?: string;
        cursor?: string;
      };

      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const result = await sessionService.listSessions(
        tenant.id,
        {
          ...(query.status && { status: query.status }),
        },
        {
          limit,
          cursor: query.cursor,
        }
      );

      reply.status(200).send({
        success: true,
        data: result.items.map(formatSession),
        meta: result.meta,
      });
    }
  );

  // GET /api/v1/live/sessions/:sessionId -> 200 OK
  fastify.get(
    '/api/v1/live/sessions/:sessionId',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { sessionId: string };

      const session = await sessionService.getSession(tenant.id, params.sessionId);
      if (!session) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Session not found',
            requestId: request.id,
          },
        });
        return;
      }

      reply.status(200).send({
        success: true,
        data: formatSession(session),
      });
    }
  );

  // DELETE /api/v1/live/sessions/:sessionId -> 202 Accepted
  fastify.delete(
    '/api/v1/live/sessions/:sessionId',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { sessionId: string };

      const session = await sessionService.disconnectSession(tenant.id, params.sessionId);
      reply.status(202).send({
        success: true,
        data: formatSession(session),
      });
    }
  );

  // POST /api/v1/live/sessions/:sessionId/chat -> 200 OK
  fastify.post(
    '/api/v1/live/sessions/:sessionId/chat',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { sessionId: string };
      const body = (request.body || {}) as { message?: string };

      if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'message is required and must not be empty',
            requestId: request.id,
          },
        });
        return;
      }

      const sendResult = await sessionService.sendChatMessage(
        tenant.id,
        params.sessionId,
        body.message
      );

      if (!sendResult.success) {
        reply.status(502).send({
          success: false,
          error: {
            code: 'UPSTREAM_ERROR',
            message: sendResult.error || 'Failed to send message to live stream',
            requestId: request.id,
          },
        });
        return;
      }

      reply.status(200).send({
        success: true,
        data: sendResult.result || { message: 'Message sent successfully' },
      });
    }
  );
}
