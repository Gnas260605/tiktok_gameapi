import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';

/**
 * Resolves a file under public/ in both development (src/) and production (dist/src/).
 */
function resolvePublicFile(fileName: string): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'public', fileName),
    path.resolve(__dirname, '../../public', fileName),
    path.resolve(__dirname, '../../../public', fileName),
  ];
  return candidatePaths.find((candidate) => fs.existsSync(candidate)) ?? candidatePaths[0];
}

function createHtmlHandler(fileName: string) {
  const htmlPath = resolvePublicFile(fileName);

  return async (_request: FastifyRequest, reply: FastifyReply) => {
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
}

export function registerDashboardRoutes(fastify: FastifyInstance): void {
  const dashboardHandler = createHtmlHandler('index.html');
  fastify.get('/', dashboardHandler);
  fastify.get('/dashboard', dashboardHandler);
  fastify.get('/live', dashboardHandler);

  // Stream overlay game, meant to be added as a browser source in OBS / LIVE Studio
  fastify.get('/game', createHtmlHandler('game.html'));

  // Public bootstrap defaults for zero-config onboarding (just enter TikTok ID)
  fastify.get('/api/v1/public/session-defaults', async () => {
    return {
      success: true,
      data: {
        defaultApiKey: 'tik_live_acme_secret_key_1234567890abcdef',
        defaultCreator: 'anvatcomai.food',
        mode: process.env.TIKTOK_CONNECTOR_MODE || 'live',
      },
    };
  });

  // Game art. Names are restricted to a flat whitelist pattern, so no path traversal.
  const assetDir = path.dirname(resolvePublicFile(path.join('game-assets', 'pagoda.png')));
  fastify.get('/game-assets/:file', async (request: FastifyRequest, reply: FastifyReply) => {
    const { file } = request.params as { file: string };
    const assetPath = path.join(assetDir, file);
    if (!/^[a-z0-9-]+\.png$/.test(file) || !fs.existsSync(assetPath)) {
      reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Asset not found', requestId: request.id },
      });
      return;
    }
    reply
      .type('image/png')
      .header('Cache-Control', 'public, max-age=86400')
      .send(fs.readFileSync(assetPath));
  });
}
