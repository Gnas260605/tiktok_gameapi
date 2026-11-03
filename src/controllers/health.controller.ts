import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

export function registerHealthRoutes(fastify: FastifyInstance, prisma: PrismaClient): void {
  const handlerLive = async (_req: any, reply: any) => {
    reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  };

  const handlerReady = async (_req: any, reply: any) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    } catch {
      reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database connection is unhealthy',
        },
      });
    }
  };

  // Root health probes
  fastify.get('/health/live', handlerLive);
  fastify.get('/health/ready', handlerReady);

  // Aliased under /api/v1/health/*
  fastify.get('/api/v1/health/live', handlerLive);
  fastify.get('/api/v1/health/ready', handlerReady);
}
