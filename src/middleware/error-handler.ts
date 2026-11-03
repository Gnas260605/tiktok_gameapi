import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : 500;

  let code = (error as any).code || 'INTERNAL_ERROR';

  // Handle Fastify schema validation errors
  if (error.validation) {
    code = 'BAD_REQUEST';
  } else if (statusCode === 400) {
    code = code === 'INTERNAL_ERROR' ? 'BAD_REQUEST' : code;
  } else if (statusCode === 401) {
    code = code === 'INTERNAL_ERROR' ? 'UNAUTHORIZED' : code;
  } else if (statusCode === 403) {
    code = code === 'INTERNAL_ERROR' ? 'FORBIDDEN' : code;
  } else if (statusCode === 404) {
    code = code === 'INTERNAL_ERROR' ? 'NOT_FOUND' : code;
  } else if (statusCode === 409) {
    code = code === 'INTERNAL_ERROR' ? 'CONFLICT' : code;
  } else if (statusCode === 429) {
    code = code === 'INTERNAL_ERROR' ? 'RATE_LIMITED' : code;
  }

  const message = error.message || 'An unexpected error occurred';

  if (statusCode >= 500) {
    request.log.error(error);
  }

  reply.status(statusCode).send({
    success: false,
    error: {
      code,
      message,
      ...(error.validation && { details: error.validation }),
      ...((error as any).details && { details: (error as any).details }),
      requestId: request.id,
    },
  });
}
