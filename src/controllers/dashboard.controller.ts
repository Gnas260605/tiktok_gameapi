import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';

export function registerDashboardRoutes(fastify: FastifyInstance): void {
  // Resolve public/index.html in both development (src/) and production (dist/src/)
  const candidatePaths = [
    path.resolve(process.cwd(), 'public/index.html'),
    path.resolve(__dirname, '../../public/index.html'),
    path.resolve(__dirname, '../../../public/index.html'),
  ];

  let htmlPath = candidatePaths[0];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      htmlPath = candidate;
      break;
    }
  }

  const handler = async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf8');
        reply.type('text/html; charset=utf-8').send(html);
      } else {
        reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Dashboard UI template not found on server',
          },
        });
      }
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: `Failed to load dashboard UI: ${err.message}`,
        },
      });
    }
  };

  fastify.get('/', handler);
  fastify.get('/dashboard', handler);
  fastify.get('/live', handler);
}
