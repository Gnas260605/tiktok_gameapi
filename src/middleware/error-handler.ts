import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../core/errors/app-error';

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

  let code = ('code' in error && typeof error.code === 'string') ? error.code : 'INTERNAL_ERROR';

  // Handle Fastify schema validation errors
  if ('validation' in error && error.validation) {
    code = 'BAD_REQUEST';
  } else if (statusCode === 400 && code === 'INTERNAL_ERROR') {
    code = 'BAD_REQUEST';
  } else if (statusCode === 401 && code === 'INTERNAL_ERROR') {
    code = 'UNAUTHORIZED';
  } else if (statusCode === 403 && code === 'INTERNAL_ERROR') {
    code = 'FORBIDDEN';
  } else if (statusCode === 404 && code === 'INTERNAL_ERROR') {
    code = 'NOT_FOUND';
  } else if (statusCode === 409 && code === 'INTERNAL_ERROR') {
    code = 'CONFLICT';
  } else if (statusCode === 429 && code === 'INTERNAL_ERROR') {
    code = 'RATE_LIMITED';
  } else if (statusCode === 502 && code === 'INTERNAL_ERROR') {
    code = 'UPSTREAM_ERROR';
  }

  const message = error.message || 'An unexpected error occurred';

  if (statusCode >= 500) {
    request.log.error(error);
  }

  const details =
    ('details' in error && error.details) ||
    ('validation' in error && error.validation) ||
    undefined;

  reply.status(statusCode).send({
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
      requestId: request.id,
    },
  });
}
