import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CreatorLookupService, CreatorLookupError } from '../services/tiktok/creator-lookup.service';

const USERNAME_REGEX = /^[a-z0-9._]{2,255}$/;

const ERROR_STATUS: Record<string, { status: number; code: string }> = {
  not_found: { status: 404, code: 'NOT_FOUND' },
  rate_limited: { status: 429, code: 'RATE_LIMITED' },
};

export function registerCreatorRoutes(
  fastify: FastifyInstance,
  lookupService: CreatorLookupService,
  authPreHandler: any
): void {
  // GET /api/v1/tiktok/creators/:username -> 200 OK
  fastify.get(
    '/api/v1/tiktok/creators/:username',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { username: string };
      const username = String(params.username || '').trim().replace(/^@+/, '').toLowerCase();

      if (!USERNAME_REGEX.test(username)) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'username must contain only letters, numbers, underscores, or dots',
            requestId: request.id,
          },
        });
        return;
      }

      try {
        const profile = await lookupService.lookup(username);
        reply.status(200).send({ success: true, data: profile });
      } catch (err: any) {
        const kind = err instanceof CreatorLookupError ? err.kind : 'unknown';
        const mapped = ERROR_STATUS[kind] ?? { status: 502, code: 'INTERNAL_ERROR' };
        request.log.warn({ kind, message: err?.message }, `Creator lookup failed for @${username}`);
        reply.status(mapped.status).send({
          success: false,
          error: {
            code: mapped.code,
            message: err?.message || 'TikTok lookup failed',
            requestId: request.id,
          },
        });
      }
    }
  );
}
