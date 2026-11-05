import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PlayerRepository } from '../repositories/game/player.repository';
import { BreakthroughRepository } from '../repositories/game/breakthrough.repository';
import { GameEventRepository } from '../repositories/game/game-event.repository';
import { PlayerService } from '../services/game/player.service';
import { BreakthroughService, BreakthroughServiceError } from '../services/game/breakthrough.service';
import { BreakthroughScheduler } from '../services/game/breakthrough-scheduler';
import { LeaderboardService, LeaderboardBoard, LeaderboardError } from '../services/game/leaderboard.service';
import { GameConfigService } from '../services/game/game-config.service';
import { EventIngestionService } from '../services/event/event-ingestion.service';
import { FIXTURE_GIFTS } from '../adapters/tiktok/mock.connector';
import { requireScope } from '../middleware/scope.middleware';
import {
  formatPlayer,
  formatPlayerProfile,
  formatBreakthrough,
  formatGiftTransaction,
  formatRealm,
} from './game-formatters';

export interface GameControllerDependencies {
  prisma: PrismaClient;
  playerRepo: PlayerRepository;
  playerService: PlayerService;
  breakthroughRepo: BreakthroughRepository;
  breakthroughService: BreakthroughService;
  breakthroughScheduler: BreakthroughScheduler;
  leaderboardService: LeaderboardService;
  gameConfigService: GameConfigService;
  gameEventRepo: GameEventRepository;
  eventIngestionService?: EventIngestionService;
}

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

export function registerGameRoutes(
  fastify: FastifyInstance,
  deps: GameControllerDependencies,
  authPreHandler: any
): void {
  const {
    prisma,
    playerRepo,
    playerService,
    breakthroughRepo,
    breakthroughService,
    breakthroughScheduler,
    leaderboardService,
    gameConfigService,
    gameEventRepo,
    eventIngestionService,
  } = deps;

  const overlayOrAdminScope = requireScope('game:overlay', 'game:admin');
  const adminScopeOnly = requireScope('game:admin');

  // =========================================================================
  // Static Overlay & Asset Routes (Public, OBS / LIVE Studio browser source)
  // =========================================================================

  // GET /tutien -> serves public/tutien/index.html
  fastify.get('/tutien', async (_request: FastifyRequest, reply: FastifyReply) => {
    const htmlPath = resolvePublicFile(path.join('tutien', 'index.html'));
    if (fs.existsSync(htmlPath)) {
      reply.type('text/html; charset=utf-8').send(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tu Tien overlay UI not found' },
      });
    }
  });

  // GET /tutien/admin -> serves public/tutien/admin.html or public/tutien/admin/index.html
  fastify.get('/tutien/admin', async (_request: FastifyRequest, reply: FastifyReply) => {
    const adminPath1 = resolvePublicFile(path.join('tutien', 'admin.html'));
    const adminPath2 = resolvePublicFile(path.join('tutien', 'admin', 'index.html'));
    const chosenPath = fs.existsSync(adminPath1) ? adminPath1 : adminPath2;
    if (fs.existsSync(chosenPath)) {
      reply.type('text/html; charset=utf-8').send(fs.readFileSync(chosenPath, 'utf8'));
    } else {
      reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tu Tien Admin UI not found' },
      });
    }
  });

  // GET /tutien-assets/:file -> regex whitelist ^[a-z0-9_-]+\.(png|webp)$
  fastify.get('/tutien-assets/:file', async (request: FastifyRequest, reply: FastifyReply) => {
    const { file } = request.params as { file: string };
    if (!/^[a-z0-9_-]+\.(png|webp)$/.test(file)) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Asset not found', requestId: request.id },
      });
    }
    const assetPath = resolvePublicFile(path.join('tutien-assets', file));
    if (!fs.existsSync(assetPath)) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Asset not found', requestId: request.id },
      });
    }
    const contentType = file.endsWith('.webp') ? 'image/webp' : 'image/png';
    reply
      .type(contentType)
      .header('Cache-Control', 'public, max-age=86400')
      .send(fs.readFileSync(assetPath));
  });

  // =========================================================================
  // Game State & Realms
  // =========================================================================

  // GET /api/v1/game/state?liveSessionId=...
  fastify.get(
    '/api/v1/game/state',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as { liveSessionId?: string };

      if (!query.liveSessionId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Query parameter liveSessionId is required',
            requestId: request.id,
          },
        });
      }

      const session = await prisma.liveSession.findFirst({
        where: { id: query.liveSessionId, tenantId: tenant.id },
      });

      if (!session) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Live session not found',
            requestId: request.id,
          },
        });
      }

      const [latestSeq, config, activeSessions] = await Promise.all([
        gameEventRepo.getLatestSeq(tenant.id),
        gameConfigService.getConfig(tenant.id),
        prisma.breakthroughSession.findMany({
          where: {
            tenantId: tenant.id,
            liveSessionId: query.liveSessionId,
            status: { in: ['preparing', 'resolving'] },
          },
          include: { history: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const activeBreakthroughs = activeSessions.map(formatBreakthrough);

      // Determine spotlight player
      let spotlightProfile: any = null;
      if (activeBreakthroughs.length > 0) {
        spotlightProfile = await playerService.getPlayerProfile(
          tenant.id,
          activeBreakthroughs[0].playerId
        );
      } else {
        const cultivationBoard = await leaderboardService.getLeaderboard(
          tenant.id,
          'cultivation',
          { scope: 'session', liveSessionId: query.liveSessionId, limit: 1 }
        );
        if (cultivationBoard.entries.length > 0) {
          spotlightProfile = await playerService.getPlayerProfile(
            tenant.id,
            cultivationBoard.entries[0].playerId
          );
        }
      }

      const boards: LeaderboardBoard[] = [
        'realm',
        'level',
        'cultivation',
        'breakthrough',
        'gifts',
      ];
      const leaderboards = await Promise.all(
        boards.map((b) =>
          leaderboardService.getLeaderboard(tenant.id, b, {
            scope: 'session',
            liveSessionId: query.liveSessionId,
            limit: 10,
          })
        )
      );

      reply.status(200).send({
        success: true,
        data: {
          lastSeq: latestSeq.toString(),
          flags: {
            gameEnabled: config.values.gameEnabled,
            giftProcessingEnabled: config.values.giftProcessingEnabled,
            effectsEnabled: config.values.effectsEnabled,
          },
          activeBreakthroughs,
          spotlightPlayer: formatPlayerProfile(spotlightProfile),
          leaderboards,
        },
      });
    }
  );

  // GET /api/v1/game/realms
  fastify.get(
    '/api/v1/game/realms',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const realms = await prisma.cultivationRealm.findMany({
        where: { tenantId: tenant.id },
        include: {
          levels: { orderBy: { level: 'asc' } },
        },
        orderBy: { realmOrder: 'asc' },
      });

      reply.status(200).send({
        success: true,
        data: realms.map(formatRealm),
      });
    }
  );

  // =========================================================================
  // Players
  // =========================================================================

  // GET /api/v1/game/players
  fastify.get(
    '/api/v1/game/players',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as {
        q?: string;
        cursor?: string;
        limit?: string;
      };

      const limit = query.limit
        ? Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100)
        : 20;

      const [result, realms, levelTable] = await Promise.all([
        playerRepo.listPlayers(tenant.id, query.q, query.cursor, limit),
        gameConfigService.getRealms(tenant.id),
        gameConfigService.getLevelTable(tenant.id),
      ]);

      const formatted = result.items.map((p) => formatPlayer(p, realms, levelTable));

      reply.status(200).send({
        success: true,
        data: formatted,
        meta: result.meta,
      });
    }
  );

  // GET /api/v1/game/players/by-username/:username
  fastify.get(
    '/api/v1/game/players/by-username/:username',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { username: string };

      const player = await playerRepo.findByUsername(tenant.id, params.username);
      if (!player) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Player not found',
            requestId: request.id,
          },
        });
      }

      const profile = await playerService.getPlayerProfile(tenant.id, player.id);
      reply.status(200).send({
        success: true,
        data: formatPlayerProfile(profile),
      });
    }
  );

  // GET /api/v1/game/players/:playerId
  fastify.get(
    '/api/v1/game/players/:playerId',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { playerId: string };

      const profile = await playerService.getPlayerProfile(tenant.id, params.playerId);
      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Player not found',
            requestId: request.id,
          },
        });
      }

      reply.status(200).send({
        success: true,
        data: formatPlayerProfile(profile),
      });
    }
  );

  // GET /api/v1/game/players/:playerId/status
  fastify.get(
    '/api/v1/game/players/:playerId/status',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { playerId: string };

      const [player, config, realms, levelTable] = await Promise.all([
        playerRepo.findById(tenant.id, params.playerId),
        gameConfigService.getConfig(tenant.id),
        gameConfigService.getRealms(tenant.id),
        gameConfigService.getLevelTable(tenant.id),
      ]);

      if (!player) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Player not found',
            requestId: request.id,
          },
        });
      }

      const realm = realms.find((r) => r.realmOrder === player.realmOrder);
      const now = new Date();

      let canBreakthrough = true;
      let blockedReason: string | null = null;
      let cooldownRemainingSeconds = 0;
      let activeBreakthroughId: string | null = null;

      if (!config.values.gameEnabled) {
        canBreakthrough = false;
        blockedReason = 'GAME_DISABLED';
      } else {
        const active = await breakthroughRepo.findActiveSessionByPlayer(
          tenant.id,
          player.id
        );
        if (active) {
          canBreakthrough = false;
          blockedReason = 'ALREADY_IN_PROGRESS';
          activeBreakthroughId = active.id;
        } else if (
          player.breakthroughCooldownUntil &&
          player.breakthroughCooldownUntil > now
        ) {
          canBreakthrough = false;
          blockedReason = 'COOLDOWN';
          cooldownRemainingSeconds = Math.ceil(
            (player.breakthroughCooldownUntil.getTime() - now.getTime()) / 1000
          );
        } else if (player.realmOrder >= 8) {
          canBreakthrough = false;
          blockedReason = 'MAX_REALM';
        } else if (player.level < 10) {
          canBreakthrough = false;
          blockedReason = 'NOT_MAX_LEVEL';
        } else {
          const req10 = levelTable.required(player.realmOrder, 10);
          if (player.currentExp < req10) {
            canBreakthrough = false;
            blockedReason = 'NOT_ENOUGH_EXP';
          } else {
            const activeCount = await breakthroughRepo.countActiveSessions(tenant.id);
            if (activeCount >= config.values.maxConcurrentBreakthroughs) {
              canBreakthrough = false;
              blockedReason = 'TOO_MANY_CONCURRENT';
            }
          }
        }
      }

      reply.status(200).send({
        success: true,
        data: {
          playerId: player.id,
          canBreakthrough,
          blockedReason,
          cooldownRemainingSeconds,
          activeBreakthroughId,
          baseChanceBp: realm?.baseChanceBp ?? null,
        },
      });
    }
  );

  // GET /api/v1/game/players/:playerId/gift-transactions
  fastify.get(
    '/api/v1/game/players/:playerId/gift-transactions',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { playerId: string };
      const query = (request.query || {}) as { cursor?: string; limit?: string };

      const player = await playerRepo.findById(tenant.id, params.playerId);
      if (!player) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Player not found',
            requestId: request.id,
          },
        });
      }

      const limit = query.limit
        ? Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100)
        : 20;

      let decodedCursor: { id: string; timestamp: number } | null = null;
      if (query.cursor) {
        try {
          const raw = Buffer.from(query.cursor, 'base64').toString('utf-8');
          const [id, ts] = raw.split('_');
          decodedCursor = { id, timestamp: parseInt(ts, 10) };
        } catch {
          // ignore invalid cursor
        }
      }

      const where: any = { tenantId: tenant.id, playerId: params.playerId };
      if (decodedCursor) {
        where.OR = [
          { createdAt: { lt: new Date(decodedCursor.timestamp) } },
          {
            createdAt: new Date(decodedCursor.timestamp),
            id: { lt: decodedCursor.id },
          },
        ];
      }

      const items = await prisma.giftTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      const hasMore = items.length > limit;
      const records = hasMore ? items.slice(0, limit) : items;
      let nextCursor: string | null = null;
      if (hasMore && records.length > 0) {
        const last = records[records.length - 1];
        nextCursor = Buffer.from(`${last.id}_${last.createdAt.getTime()}`).toString(
          'base64'
        );
      }

      reply.status(200).send({
        success: true,
        data: records.map(formatGiftTransaction),
        meta: { nextCursor, hasMore },
      });
    }
  );

  // GET /api/v1/game/players/:playerId/breakthroughs
  fastify.get(
    '/api/v1/game/players/:playerId/breakthroughs',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { playerId: string };
      const query = (request.query || {}) as { cursor?: string; limit?: string };

      const player = await playerRepo.findById(tenant.id, params.playerId);
      if (!player) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Player not found',
            requestId: request.id,
          },
        });
      }

      const limit = query.limit
        ? Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100)
        : 20;

      let decodedCursor: { id: string; timestamp: number } | null = null;
      if (query.cursor) {
        try {
          const raw = Buffer.from(query.cursor, 'base64').toString('utf-8');
          const [id, ts] = raw.split('_');
          decodedCursor = { id, timestamp: parseInt(ts, 10) };
        } catch {
          // ignore invalid cursor
        }
      }

      const where: any = { tenantId: tenant.id, playerId: params.playerId };
      if (decodedCursor) {
        where.OR = [
          { createdAt: { lt: new Date(decodedCursor.timestamp) } },
          {
            createdAt: new Date(decodedCursor.timestamp),
            id: { lt: decodedCursor.id },
          },
        ];
      }

      const items = await prisma.breakthroughSession.findMany({
        where,
        include: { history: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      const hasMore = items.length > limit;
      const records = hasMore ? items.slice(0, limit) : items;
      let nextCursor: string | null = null;
      if (hasMore && records.length > 0) {
        const last = records[records.length - 1];
        nextCursor = Buffer.from(`${last.id}_${last.createdAt.getTime()}`).toString(
          'base64'
        );
      }

      reply.status(200).send({
        success: true,
        data: records.map(formatBreakthrough),
        meta: { nextCursor, hasMore },
      });
    }
  );

  // =========================================================================
  // Leaderboards
  // =========================================================================

  // GET /api/v1/game/leaderboards/:board
  fastify.get(
    '/api/v1/game/leaderboards/:board',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { board: string };
      const query = (request.query || {}) as {
        scope?: 'all' | 'session';
        liveSessionId?: string;
        limit?: string;
      };

      const validBoards: LeaderboardBoard[] = [
        'realm',
        'level',
        'cultivation',
        'breakthrough',
        'gifts',
      ];
      if (!validBoards.includes(params.board as LeaderboardBoard)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `Invalid leaderboard board '${params.board}'. Valid boards: ${validBoards.join(', ')}`,
            requestId: request.id,
          },
        });
      }

      const scope = query.scope || 'all';
      if (scope === 'session') {
        if (!query.liveSessionId) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: 'Query parameter liveSessionId is required when scope is session',
              requestId: request.id,
            },
          });
        }

        const session = await prisma.liveSession.findFirst({
          where: { id: query.liveSessionId, tenantId: tenant.id },
        });

        if (!session) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Live session not found',
              requestId: request.id,
            },
          });
        }
      }

      const limit = query.limit
        ? Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100)
        : 10;

      try {
        const leaderboard = await leaderboardService.getLeaderboard(
          tenant.id,
          params.board as LeaderboardBoard,
          {
            scope,
            liveSessionId: query.liveSessionId,
            limit,
          }
        );

        reply.status(200).send({
          success: true,
          data: leaderboard,
        });
      } catch (err: any) {
        if (err instanceof LeaderboardError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: {
              code: err.code,
              message: err.message,
              requestId: request.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // =========================================================================
  // Breakthroughs
  // =========================================================================

  // POST /api/v1/game/breakthroughs
  fastify.post(
    '/api/v1/game/breakthroughs',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const idempotencyKey =
        (request.headers['idempotency-key'] as string) ||
        (request.headers['Idempotency-Key'] as string);

      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: "Missing or invalid 'Idempotency-Key' header (8-120 characters required)",
            requestId: request.id,
          },
        });
      }

      const body = (request.body || {}) as {
        playerId?: string;
        liveSessionId?: string;
      };

      if (!body.playerId || !body.liveSessionId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Both playerId and liveSessionId are required',
            requestId: request.id,
          },
        });
      }

      // Check session exists for tenant
      const session = await prisma.liveSession.findFirst({
        where: { id: body.liveSessionId, tenantId: tenant.id },
      });
      if (!session) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Live session not found',
            requestId: request.id,
          },
        });
      }

      // Check player exists for tenant
      const player = await playerRepo.findById(tenant.id, body.playerId);
      if (!player) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Player not found',
            requestId: request.id,
          },
        });
      }

      // Compute payload hash for idempotency checking
      const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ playerId: body.playerId, liveSessionId: body.liveSessionId }))
        .digest('hex');

      // Check existing session with this requestKey
      const existingKeySession = await prisma.breakthroughSession.findFirst({
        where: { tenantId: tenant.id, requestKey: idempotencyKey },
        include: { history: true },
      });

      if (existingKeySession) {
        if (existingKeySession.requestHash !== requestHash) {
          return reply.status(422).send({
            success: false,
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: 'Idempotency-Key reused with different payload',
              requestId: request.id,
            },
          });
        }
        return reply.status(201).send({
          success: true,
          data: formatBreakthrough(existingKeySession),
        });
      }

      try {
        const newSession = await breakthroughService.startBreakthrough(
          tenant.id,
          body.playerId,
          'api',
          body.liveSessionId,
          idempotencyKey,
          requestHash
        );

        // Schedule timer resolution
        breakthroughScheduler.schedule(tenant.id, newSession.id, newSession.endsAt);

        reply.status(201).send({
          success: true,
          data: formatBreakthrough(newSession),
        });
      } catch (err: any) {
        if (err instanceof BreakthroughServiceError || err.statusCode) {
          const reason =
            err.code === 'INSUFFICIENT_EXP' ? 'NOT_ENOUGH_EXP' : err.code;
          return reply.status(err.statusCode || 409).send({
            success: false,
            error: {
              code: err.statusCode === 404 ? 'NOT_FOUND' : 'CONFLICT',
              message: err.message,
              details: { reason, ...(err.details || {}) },
              requestId: request.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // GET /api/v1/game/breakthroughs/:breakthroughId
  fastify.get(
    '/api/v1/game/breakthroughs/:breakthroughId',
    { preHandler: [authPreHandler, overlayOrAdminScope] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { breakthroughId: string };

      const session = await prisma.breakthroughSession.findFirst({
        where: { id: params.breakthroughId, tenantId: tenant.id },
        include: { history: true },
      });

      if (!session) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Breakthrough session not found',
            requestId: request.id,
          },
        });
      }

      reply.status(200).send({
        success: true,
        data: formatBreakthrough(session),
      });
    }
  );

  // =========================================================================
  // Demo Simulation (Mock Connector Mode only)
  // =========================================================================

  // POST /api/v1/game/demo/simulate
  fastify.post(
    '/api/v1/game/demo/simulate',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const mode = process.env.TIKTOK_CONNECTOR_MODE || 'live';

      if (mode !== 'mock') {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'Simulate API is only available when TIKTOK_CONNECTOR_MODE=mock',
            requestId: request.id,
          },
        });
      }

      const body = (request.body || {}) as {
        liveSessionId?: string;
        kind?: 'chat' | 'gift';
        username?: string;
        comment?: string;
        giftId?: string;
        repeatCount?: number;
      };

      if (!body.liveSessionId || !body.kind || !body.username) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'liveSessionId, kind, and username are required',
            requestId: request.id,
          },
        });
      }

      const session = await prisma.liveSession.findFirst({
        where: { id: body.liveSessionId, tenantId: tenant.id },
      });

      if (!session) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Live session not found',
            requestId: request.id,
          },
        });
      }

      if (eventIngestionService) {
        if (body.kind === 'chat') {
          const chatEvent = {
            id: `sim_chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            eventType: 'chat',
            eventTimestamp: new Date(),
            user: {
              platform: 'tiktok',
              uniqueId: body.username,
              nickname: body.username,
              identityQuality: 'handle_fallback',
            },
            payload: {
              comment: body.comment || '',
            },
          };
          eventIngestionService.ingestEvent(chatEvent, {
            tenantId: tenant.id,
            sessionId: body.liveSessionId,
          });
        } else if (body.kind === 'gift') {
          const gift =
            FIXTURE_GIFTS.find((g) => g.giftId === body.giftId) || {
              giftId: body.giftId || '5655',
              giftName: 'Rose',
              diamondCount: 1,
            };
          const count = body.repeatCount || 1;
          const giftEvent = {
            id: `sim_gift_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            eventType: 'gift',
            eventTimestamp: new Date(),
            user: {
              platform: 'tiktok',
              uniqueId: body.username,
              nickname: body.username,
              identityQuality: 'handle_fallback',
            },
            payload: {
              giftId: gift.giftId,
              giftName: gift.giftName,
              diamondCount: gift.diamondCount,
              repeatCount: count,
              totalDiamonds: gift.diamondCount * count,
              repeatEnd: true,
            },
          };
          eventIngestionService.ingestEvent(giftEvent, {
            tenantId: tenant.id,
            sessionId: body.liveSessionId,
          });
        }
      }

      reply.status(202).send({
        success: true,
        data: { status: 'queued' },
      });
    }
  );
}
