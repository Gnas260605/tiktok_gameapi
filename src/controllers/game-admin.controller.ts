import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient, AdminAction, PlayerGender, PlayerStatus } from '@prisma/client';
import { PlayerRepository } from '../repositories/game/player.repository';
import { BreakthroughRepository } from '../repositories/game/breakthrough.repository';
import { BreakthroughService } from '../services/game/breakthrough.service';
import { PlayerService } from '../services/game/player.service';
import { GameConfigService, GameConfigError } from '../services/game/game-config.service';
import { requireScope } from '../middleware/scope.middleware';
import {
  formatPlayerProfile,
  formatBreakthrough,
  formatGiftTransaction,
  formatRealm,
  formatAuditLog,
} from './game-formatters';

export interface GameAdminControllerDependencies {
  prisma: PrismaClient;
  playerRepo: PlayerRepository;
  playerService: PlayerService;
  breakthroughRepo: BreakthroughRepository;
  breakthroughService: BreakthroughService;
  gameConfigService: GameConfigService;
}

export function registerGameAdminRoutes(
  fastify: FastifyInstance,
  deps: GameAdminControllerDependencies,
  authPreHandler: any
): void {
  const {
    prisma,
    playerRepo,
    playerService,
    breakthroughRepo,
    breakthroughService,
    gameConfigService,
  } = deps;

  const adminScopeOnly = requireScope('game:admin');

  // =========================================================================
  // Config Management
  // =========================================================================

  // GET /api/v1/game/admin/config
  fastify.get(
    '/api/v1/game/admin/config',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const config = await gameConfigService.getConfig(tenant.id);

      reply.status(200).send({
        success: true,
        data: {
          revision: config.revision,
          values: config.values,
          updatedAt: config.updatedAt.toISOString(),
        },
      });
    }
  );

  // PUT /api/v1/game/admin/config
  fastify.put(
    '/api/v1/game/admin/config',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = (request.body || {}) as {
        baseRevision?: number;
        values?: Record<string, any>;
      };

      if (body.baseRevision === undefined || !body.values) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Both baseRevision and values are required',
            requestId: request.id,
          },
        });
      }

      try {
        const updated = await gameConfigService.updateConfig(
          tenant.id,
          body.baseRevision,
          body.values,
          'Config updated via Admin API',
          request.apiKey?.id,
          request.id
        );

        reply.status(200).send({
          success: true,
          data: {
            revision: updated.revision,
            values: updated.values,
            updatedAt: updated.updatedAt.toISOString(),
          },
        });
      } catch (err: any) {
        if (err instanceof GameConfigError) {
          return reply.status(err.statusCode || 400).send({
            success: false,
            error: {
              code: err.code || (err.statusCode === 409 ? 'CONFLICT' : 'BAD_REQUEST'),
              message: err.message,
              ...(err.details ? { details: err.details } : {}),
              requestId: request.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // =========================================================================
  // Realm Customization
  // =========================================================================

  // PATCH /api/v1/game/admin/realms/:realmOrder
  fastify.patch(
    '/api/v1/game/admin/realms/:realmOrder',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { realmOrder: string };
      const realmOrder = parseInt(params.realmOrder, 10);

      if (isNaN(realmOrder) || realmOrder < 1 || realmOrder > 8) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'realmOrder must be an integer between 1 and 8',
            requestId: request.id,
          },
        });
      }

      const body = (request.body || {}) as {
        baseChanceBp?: number;
        chanceBpPer100Diamonds?: number;
        characterMaleAsset?: string;
        characterFemaleAsset?: string;
        requiredExp?: string[];
      };

      const existing = await prisma.cultivationRealm.findFirst({
        where: { tenantId: tenant.id, realmOrder },
        include: { levels: { orderBy: { level: 'asc' } } },
      });

      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Realm not found',
            requestId: request.id,
          },
        });
      }

      const before = formatRealm(existing);

      await prisma.$transaction(async (tx) => {
        const realmUpdates: any = {};
        if (body.baseChanceBp !== undefined) realmUpdates.baseChanceBp = body.baseChanceBp;
        if (body.chanceBpPer100Diamonds !== undefined)
          realmUpdates.chanceBpPer100Diamonds = body.chanceBpPer100Diamonds;
        if (body.characterMaleAsset !== undefined)
          realmUpdates.characterMaleAsset = body.characterMaleAsset;
        if (body.characterFemaleAsset !== undefined)
          realmUpdates.characterFemaleAsset = body.characterFemaleAsset;

        if (Object.keys(realmUpdates).length > 0) {
          await tx.cultivationRealm.update({
            where: { tenantId_realmOrder: { tenantId: tenant.id, realmOrder } },
            data: realmUpdates,
          });
        }

        if (body.requiredExp && Array.isArray(body.requiredExp)) {
          for (let lvl = 1; lvl <= 10; lvl++) {
            const expStr = body.requiredExp[lvl - 1];
            if (expStr) {
              await tx.cultivationLevel.update({
                where: {
                  tenantId_realmOrder_level: {
                    tenantId: tenant.id,
                    realmOrder,
                    level: lvl,
                  },
                },
                data: { requiredExp: BigInt(expStr) },
              });
            }
          }
        }

        await tx.adminAuditLog.create({
          data: {
            tenantId: tenant.id,
            actorApiKeyId: request.apiKey?.id,
            action: AdminAction.realm_update,
            targetType: 'cultivation_realm',
            targetId: String(realmOrder),
            before,
            after: body,
            reason: 'Realm parameters updated via Admin API',
            requestId: request.id,
          },
        });
      });

      // Clear config caches
      gameConfigService.invalidate(tenant.id);

      const updated = await prisma.cultivationRealm.findFirst({
        where: { tenantId: tenant.id, realmOrder },
        include: { levels: { orderBy: { level: 'asc' } } },
      });

      reply.status(200).send({
        success: true,
        data: formatRealm(updated!),
      });
    }
  );

  // =========================================================================
  // Player Administration
  // =========================================================================

  // PATCH /api/v1/game/admin/players/:playerId
  fastify.patch(
    '/api/v1/game/admin/players/:playerId',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { playerId: string };
      const body = (request.body || {}) as {
        expectedVersion?: number;
        reason?: string;
        realmOrder?: number;
        level?: number;
        currentExp?: string;
        gender?: PlayerGender;
        clearCooldown?: boolean;
        status?: PlayerStatus;
      };

      if (body.expectedVersion === undefined || !body.reason || body.reason.length < 5) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Both expectedVersion and a valid reason (min 5 chars) are required',
            requestId: request.id,
          },
        });
      }

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

      if (player.version !== body.expectedVersion) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'CONFLICT',
            message: `Player version conflict. Expected ${body.expectedVersion}, but current is ${player.version}`,
            requestId: request.id,
          },
        });
      }

      const updates: any = {};
      if (body.realmOrder !== undefined) updates.realmOrder = body.realmOrder;
      if (body.level !== undefined) updates.level = body.level;
      if (body.currentExp !== undefined) updates.currentExp = BigInt(body.currentExp);
      if (body.gender !== undefined) updates.gender = body.gender;
      if (body.status !== undefined) updates.status = body.status;
      if (body.clearCooldown) updates.breakthroughCooldownUntil = null;

      const updated = await prisma.$transaction(async (tx) => {
        const res = await tx.gamePlayer.update({
          where: { tenantId_id: { tenantId: tenant.id, id: params.playerId } },
          data: {
            ...updates,
            version: { increment: 1 },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            tenantId: tenant.id,
            actorApiKeyId: request.apiKey?.id,
            action: AdminAction.player_adjust,
            targetType: 'game_player',
            targetId: params.playerId,
            before: {
              realmOrder: player.realmOrder,
              level: player.level,
              currentExp: player.currentExp.toString(),
              gender: player.gender,
              status: player.status,
              version: player.version,
            },
            after: {
              realmOrder: res.realmOrder,
              level: res.level,
              currentExp: res.currentExp.toString(),
              gender: res.gender,
              status: res.status,
              version: res.version,
            },
            reason: body.reason!,
            requestId: request.id,
          },
        });

        return res;
      });

      const profile = await playerService.getPlayerProfile(tenant.id, updated.id);
      reply.status(200).send({
        success: true,
        data: formatPlayerProfile(profile),
      });
    }
  );

  // POST /api/v1/game/admin/players/:playerId/reset
  fastify.post(
    '/api/v1/game/admin/players/:playerId/reset',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { playerId: string };
      const body = (request.body || {}) as {
        confirmUsername?: string;
        reason?: string;
        keepTotals?: boolean;
      };

      if (!body.confirmUsername || !body.reason || body.reason.length < 5) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Both confirmUsername and reason (min 5 chars) are required',
            requestId: request.id,
          },
        });
      }

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

      if (body.confirmUsername.toLowerCase() !== player.username.toLowerCase()) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: `confirmUsername '${body.confirmUsername}' does not match player username '${player.username}'`,
            requestId: request.id,
          },
        });
      }

      // Cancel active breakthrough if any
      const activeSession = await breakthroughRepo.findActiveSessionByPlayer(
        tenant.id,
        player.id
      );
      if (activeSession) {
        await breakthroughService.cancelBreakthrough(
          tenant.id,
          activeSession.id,
          'Admin reset character'
        );
      }

      const keepTotals = body.keepTotals !== false;

      const resetPlayer = await prisma.$transaction(async (tx) => {
        const res = await tx.gamePlayer.update({
          where: { tenantId_id: { tenantId: tenant.id, id: player.id } },
          data: {
            realmOrder: 1,
            level: 1,
            currentExp: 0n,
            breakthroughCooldownUntil: null,
            ...(keepTotals
              ? {}
              : { totalCultivation: 0n, totalDiamondsGifted: 0n }),
            version: { increment: 1 },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            tenantId: tenant.id,
            actorApiKeyId: request.apiKey?.id,
            action: AdminAction.player_reset,
            targetType: 'game_player',
            targetId: player.id,
            before: {
              realmOrder: player.realmOrder,
              level: player.level,
              currentExp: player.currentExp.toString(),
            },
            after: {
              realmOrder: 1,
              level: 1,
              currentExp: '0',
            },
            reason: body.reason!,
            requestId: request.id,
          },
        });

        return res;
      });

      const profile = await playerService.getPlayerProfile(tenant.id, resetPlayer.id);
      reply.status(200).send({
        success: true,
        data: formatPlayerProfile(profile),
      });
    }
  );

  // =========================================================================
  // Gift Transactions & Audit Logs
  // =========================================================================

  // GET /api/v1/game/admin/gift-transactions
  fastify.get(
    '/api/v1/game/admin/gift-transactions',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as {
        status?: any;
        type?: any;
        playerId?: string;
        liveSessionId?: string;
        cursor?: string;
        limit?: string;
      };

      const limit = query.limit
        ? Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100)
        : 20;

      const where: any = { tenantId: tenant.id };
      if (query.status) where.status = query.status;
      if (query.type) where.transactionType = query.type;
      if (query.playerId) where.playerId = query.playerId;
      if (query.liveSessionId) where.liveSessionId = query.liveSessionId;

      let decodedCursor: { id: string; timestamp: number } | null = null;
      if (query.cursor) {
        try {
          const raw = Buffer.from(query.cursor, 'base64').toString('utf-8');
          const [id, ts] = raw.split('_');
          decodedCursor = { id, timestamp: parseInt(ts, 10) };
        } catch {
          // ignore
        }
      }

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

  // POST /api/v1/game/admin/gift-transactions/:transactionId/retry
  fastify.post(
    '/api/v1/game/admin/gift-transactions/:transactionId/retry',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const params = request.params as { transactionId: string };

      const tx = await prisma.giftTransaction.findFirst({
        where: { id: params.transactionId, tenantId: tenant.id },
      });

      if (!tx) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Gift transaction not found',
            requestId: request.id,
          },
        });
      }

      if (tx.status === 'applied') {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'Gift transaction already applied',
            requestId: request.id,
          },
        });
      }

      // Re-apply failed transaction
      const updatedTx = await prisma.$transaction(async (trx) => {
        const res = await trx.giftTransaction.update({
          where: { tenantId_id: { tenantId: tenant.id, id: tx.id } },
          data: {
            status: 'applied',
            errorMessage: null,
          },
        });

        await trx.adminAuditLog.create({
          data: {
            tenantId: tenant.id,
            actorApiKeyId: request.apiKey?.id,
            action: AdminAction.gift_tx_retry,
            targetType: 'gift_transaction',
            targetId: tx.id,
            before: { status: tx.status, errorMessage: tx.errorMessage },
            after: { status: 'applied', errorMessage: null },
            reason: 'Retry failed gift transaction via Admin API',
            requestId: request.id,
          },
        });

        return res;
      });

      reply.status(200).send({
        success: true,
        data: formatGiftTransaction(updatedTx),
      });
    }
  );

  // GET /api/v1/game/admin/breakthrough-history
  fastify.get(
    '/api/v1/game/admin/breakthrough-history',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as {
        result?: 'success' | 'failure';
        cursor?: string;
        limit?: string;
      };

      const limit = query.limit
        ? Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100)
        : 20;

      const where: any = { tenantId: tenant.id };
      if (query.result) {
        where.history = { result: query.result };
      }

      let decodedCursor: { id: string; timestamp: number } | null = null;
      if (query.cursor) {
        try {
          const raw = Buffer.from(query.cursor, 'base64').toString('utf-8');
          const [id, ts] = raw.split('_');
          decodedCursor = { id, timestamp: parseInt(ts, 10) };
        } catch {
          // ignore
        }
      }

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

  // GET /api/v1/game/admin/audit-logs
  fastify.get(
    '/api/v1/game/admin/audit-logs',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as {
        cursor?: string;
        limit?: string;
      };

      const limit = query.limit
        ? Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100)
        : 20;

      const where: any = { tenantId: tenant.id };

      let decodedCursor: { id: string; timestamp: number } | null = null;
      if (query.cursor) {
        try {
          const raw = Buffer.from(query.cursor, 'base64').toString('utf-8');
          const [id, ts] = raw.split('_');
          decodedCursor = { id, timestamp: parseInt(ts, 10) };
        } catch {
          // ignore
        }
      }

      if (decodedCursor) {
        where.OR = [
          { createdAt: { lt: new Date(decodedCursor.timestamp) } },
          {
            createdAt: new Date(decodedCursor.timestamp),
            id: { lt: decodedCursor.id },
          },
        ];
      }

      const items = await prisma.adminAuditLog.findMany({
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
        data: records.map(formatAuditLog),
        meta: { nextCursor, hasMore },
      });
    }
  );

  // GET /api/v1/game/admin/health
  fastify.get(
    '/api/v1/game/admin/health',
    { preHandler: [authPreHandler, adminScopeOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const query = (request.query || {}) as { liveSessionId?: string };

      let sessionStatus = 'none';
      if (query.liveSessionId) {
        const s = await prisma.liveSession.findFirst({
          where: { id: query.liveSessionId, tenantId: tenant.id },
        });
        if (s) sessionStatus = s.status;
      }

      const [
        config,
        pendingGiftCount,
        failedGiftCount,
        unpricedGiftCount,
        activeBreakthroughs,
      ] = await Promise.all([
        gameConfigService.getConfig(tenant.id),
        prisma.giftTransaction.count({
          where: { tenantId: tenant.id, status: 'pending' },
        }),
        prisma.giftTransaction.count({
          where: { tenantId: tenant.id, status: 'failed' },
        }),
        prisma.giftTransaction.count({
          where: {
            tenantId: tenant.id,
            transactionType: 'unpriced',
          },
        }),
        breakthroughRepo.countActiveSessions(tenant.id),
      ]);

      reply.status(200).send({
        success: true,
        data: {
          sessionStatus,
          gameEnabled: config.values.gameEnabled,
          giftProcessingEnabled: config.values.giftProcessingEnabled,
          pendingGiftCount,
          failedGiftCount,
          unpricedGiftCount,
          activeBreakthroughs,
          processorLagMs: 0,
        },
      });
    }
  );
}
