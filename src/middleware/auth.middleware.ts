import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../services/auth/auth.service';
import { Tenant, ApiKey } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: Tenant;
    apiKey?: ApiKey;
  }
}

export function createAuthPreHandler(authService: AuthService) {
  return async function authenticateApiKey(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    const xApiKeyHeader = request.headers['x-api-key'];

    let rawKey: string | undefined;

    if (authHeader && typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        rawKey = match[1].trim();
      }
    }

    if (!rawKey && xApiKeyHeader && typeof xApiKeyHeader === 'string') {
      rawKey = xApiKeyHeader.trim();
    }

    if (!rawKey) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: "Missing API Key. Provide via 'Authorization: Bearer <key>' or 'X-API-Key: <key>' header.",
          requestId: request.id,
        },
      });
      return;
    }

    try {
      const context = await authService.authenticate(rawKey);
      request.tenant = context.tenant;
      request.apiKey = context.apiKey;
    } catch (err: any) {
      const statusCode = err.statusCode || 401;
      const code = err.code || 'UNAUTHORIZED';
      reply.status(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Authentication failed',
          requestId: request.id,
        },
      });
    }
  };
}
