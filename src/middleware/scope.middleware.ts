import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Middleware factory to enforce scope-based access control on API keys.
 *
 * Rules:
 * - A key with '*' has full access to all endpoints.
 * - 'game:admin' satisfies both 'game:admin' and 'game:overlay'.
 * - If the API key does not possess at least one of the required scopes,
 *   a 403 FORBIDDEN error envelope is returned.
 */
export function requireScope(...requiredScopes: string[]) {
  return async function checkScope(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (requiredScopes.length === 0) {
      return;
    }

    const keyScopes = request.apiKey?.scopes || [];

    // Wildcard has all permissions
    if (keyScopes.includes('*')) {
      return;
    }

    const isAllowed = requiredScopes.some((reqScope) => {
      if (keyScopes.includes(reqScope)) return true;
      if (reqScope === 'game:overlay' && keyScopes.includes('game:admin')) return true;
      return false;
    });

    if (!isAllowed) {
      reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient scope. Required one of: ${requiredScopes.join(', ')}`,
          requestId: request.id,
        },
      });
      return;
    }
  };
}
