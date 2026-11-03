import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RealtimeTicketService } from '../services/realtime/ticket.service';
import { SessionRepository } from '../repositories/session.repository';

export function registerRealtimeRoutes(
  fastify: FastifyInstance,
  ticketService: RealtimeTicketService,
  sessionRepo: SessionRepository,
  authPreHandler: any
): void {
  // POST /api/v1/realtime/tickets -> 201 Created
  fastify.post(
    '/api/v1/realtime/tickets',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = (request.body || {}) as { sessionIds?: string[] };

      if (!body.sessionIds || !Array.isArray(body.sessionIds) || body.sessionIds.length === 0) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'sessionIds array is required and must contain at least 1 session ID',
            requestId: request.id,
          },
        });
        return;
      }

      if (body.sessionIds.length > 20) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'sessionIds array may not exceed 20 session IDs',
            requestId: request.id,
          },
        });
        return;
      }

      // Verify each sessionId belongs to tenant
      for (const sessionId of body.sessionIds) {
        const session = await sessionRepo.findById(tenant.id, sessionId);
        if (!session) {
          reply.status(403).send({
            success: false,
            error: {
              code: 'SESSION_FORBIDDEN',
              message: `Session ${sessionId} is forbidden or does not belong to your tenant`,
              requestId: request.id,
            },
          });
          return;
        }
      }

      const host = request.headers.host || 'localhost:3000';
      const wsProtocol = request.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
      const wsUrl = `${wsProtocol}://${host}/ws`;

      const result = ticketService.createTicket(tenant.id, body.sessionIds, 60, wsUrl);

      reply.status(201).send({
        success: true,
        data: {
          ticket: result.ticket,
          expiresAt: result.expiresAt,
          websocketUrl: result.websocketUrl,
        },
      });
    }
  );
}
