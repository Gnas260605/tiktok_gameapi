import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GameConfigRepository } from '../../../src/repositories/game/game-config.repository';
import { PlayerRepository } from '../../../src/repositories/game/player.repository';
import { GameEventRepository } from '../../../src/repositories/game/game-event.repository';
import { GameConfigService } from '../../../src/services/game/game-config.service';
import { PlayerService } from '../../../src/services/game/player.service';
import { GiftHandler } from '../../../src/services/game/gift-handler';
import { GameRealtimeGateway } from '../../../src/services/game/game-realtime.gateway';

describe('GiftHandler — Integration Suite (TC-G01 to TC-G12)', () => {
  const prisma = new PrismaClient();
  const tenantId = 'a0000000-0000-0000-0000-000000000001'; // Acme Corp
  const sessionId = 'b0000000-0000-0000-0000-000000000001';

  let configRepo: GameConfigRepository;
  let configService: GameConfigService;
  let playerRepo: PlayerRepository;
  let eventRepo: GameEventRepository;
  let playerService: PlayerService;
  let giftHandler: GiftHandler;
  let realtimeGateway: GameRealtimeGateway;

  beforeAll(async () => {
    configRepo = new GameConfigRepository(prisma);
    configService = new GameConfigService(configRepo);
    playerRepo = new PlayerRepository(prisma);
    eventRepo = new GameEventRepository(prisma);
    playerService = new PlayerService(playerRepo, eventRepo, configService);
    realtimeGateway = new GameRealtimeGateway();
    giftHandler = new GiftHandler(prisma, configService, playerService, realtimeGateway);

    await configRepo.ensureTenantSeeded(tenantId);

    await prisma.liveSession.upsert({
      where: { tenantId_id: { tenantId, id: sessionId } },
      update: {},
      create: {
        id: sessionId,
        tenantId,
        creatorUsername: 'streamer_test',
        status: 'connected',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('TC-G01: Rose x 1 (1 diamond) grants +10 tu vi with applied gift_transactions', async () => {
    const testId = `g01_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
        nickname: 'Rose Gifter',
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    try {
      const persistedEvent = {
        id: `evt_${testId}`,
        sourceEventId: `msg_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'rose_1',
          giftName: 'Rose',
          diamondCount: 1,
          repeatCount: 1,
          totalDiamonds: 1,
          repeatEnd: true,
        },
      };

      const result = await giftHandler.handleGift(
        tenantId,
        sessionId,
        persistedEvent,
        user
      );

      expect(result.skipped).toBeFalsy();
      expect(result.transaction).not.toBeNull();
      expect(result.transaction?.status).toBe('applied');
      expect(result.transaction?.cultivationReceived).toBe(10n);
      expect(result.transaction?.totalDiamonds).toBe(1n);

      const player = await playerRepo.findById(tenantId, joined.player.id);
      expect(player?.currentExp).toBe(10n);
      expect(player?.totalCultivation).toBe(10n);
      expect(player?.totalDiamondsGifted).toBe(1n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-G02: 100 diamonds gift grants +1,000 tu vi', async () => {
    const testId = `g02_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
        nickname: '100 Gifter',
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    try {
      const persistedEvent = {
        id: `evt_${testId}`,
        sourceEventId: `msg_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'crown_100',
          giftName: 'Crown',
          diamondCount: 100,
          repeatCount: 1,
          totalDiamonds: 100,
          repeatEnd: true,
        },
      };

      const result = await giftHandler.handleGift(
        tenantId,
        sessionId,
        persistedEvent,
        user
      );

      expect(result.transaction?.status).toBe('applied');
      expect(result.transaction?.cultivationReceived).toBe(1000n);

      const player = await playerRepo.findById(tenantId, joined.player.id);
      // LK1 requires 1,000 exp -> advances to LK2, currentExp: 0
      expect(player?.realmOrder).toBe(1);
      expect(player?.level).toBe(2);
      expect(player?.currentExp).toBe(0n);
      expect(player?.totalCultivation).toBe(1000n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-G03: Combo gift ignores repeatEnd=false and applies settled repeatCount=15 (+150 tu vi)', async () => {
    const testId = `g03_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    try {
      // 1. Intermediate tap with repeatEnd = false -> skipped
      const intermediateEvent = {
        id: `evt_mid_${testId}`,
        sourceEventId: `msg_mid_${testId}`,
        eventType: 'gift',
        data: {
          giftId: 'rose',
          diamondCount: 1,
          repeatCount: 5,
          repeatEnd: false,
        },
      };

      const intermediateResult = await giftHandler.handleGift(
        tenantId,
        sessionId,
        intermediateEvent,
        user
      );
      expect(intermediateResult.skipped).toBe(true);
      expect(intermediateResult.reason).toBe('NOT_FINAL_COMBO');

      // 2. Settled tap with repeatEnd = true, repeatCount = 15
      const settledEvent = {
        id: `evt_end_${testId}`,
        sourceEventId: `msg_end_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'rose',
          giftName: 'Rose',
          diamondCount: 1,
          repeatCount: 15,
          totalDiamonds: 15,
          repeatEnd: true,
        },
      };

      const settledResult = await giftHandler.handleGift(
        tenantId,
        sessionId,
        settledEvent,
        user
      );
      expect(settledResult.transaction?.status).toBe('applied');
      expect(settledResult.transaction?.cultivationReceived).toBe(150n);

      const player = await playerRepo.findById(tenantId, joined.player.id);
      expect(player?.currentExp).toBe(150n);
      expect(player?.totalDiamondsGifted).toBe(15n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-G04: Lion x 10 (299,990 diamonds) multi-level jump capped at realm boundary level 10 with overflow cap', async () => {
    const testId = `g04_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    try {
      const persistedEvent = {
        id: `evt_${testId}`,
        sourceEventId: `msg_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'lion_29999',
          giftName: 'Lion',
          diamondCount: 29999,
          repeatCount: 10,
          totalDiamonds: 299990,
          repeatEnd: true,
        },
      };

      const result = await giftHandler.handleGift(
        tenantId,
        sessionId,
        persistedEvent,
        user
      );

      expect(result.transaction?.status).toBe('applied');
      expect(result.transaction?.transactionType).toBe('overflow_capped');

      const player = await playerRepo.findById(tenantId, joined.player.id);
      // A gift never crosses realm boundary: caps at realm 1, level 10
      expect(player?.realmOrder).toBe(1);
      expect(player?.level).toBe(10);

      // maxOverflowRatio = 3.0, req(1, 10) = 10,000. Cap = req10 + 3*req10 = 40,000
      expect(player?.currentExp).toBe(40000n);
      // Total cultivation is preserved without cap
      expect(player?.totalCultivation).toBe(2999900n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-G05: Gift from unjoined user automatically joins and grants tu vi when autoJoinOnGift=true', async () => {
    const testId = `g05_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
        nickname: 'New Viewer',
      },
    });

    try {
      const persistedEvent = {
        id: `evt_${testId}`,
        sourceEventId: `msg_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'rose',
          giftName: 'Rose',
          diamondCount: 1,
          repeatCount: 5,
          totalDiamonds: 5,
          repeatEnd: true,
        },
      };

      const result = await giftHandler.handleGift(
        tenantId,
        sessionId,
        persistedEvent,
        user
      );

      expect(result.transaction?.status).toBe('applied');

      const createdPlayer = await playerRepo.findByUserId(tenantId, user.id);
      expect(createdPlayer).not.toBeNull();
      expect(createdPlayer?.currentExp).toBe(50n);
      expect(createdPlayer?.totalCultivation).toBe(50n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, player: { userId: user.id } } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-G09: Publishing the same gift event 100 times concurrently produces exactly 1 transaction', async () => {
    const testId = `g09_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    try {
      const persistedEvent = {
        id: `evt_idemp_${testId}`,
        sourceEventId: `msg_fixed_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'doughnut',
          giftName: 'Doughnut',
          diamondCount: 30,
          repeatCount: 1,
          totalDiamonds: 30,
          repeatEnd: true,
        },
      };

      // Launch 100 concurrent handleGift invocations for identical event
      const promises = Array.from({ length: 100 }, () =>
        giftHandler.handleGift(tenantId, sessionId, persistedEvent, user)
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);

      // Verify in DB: exactly 1 gift_transactions row with this idempotency key
      const txCount = await prisma.giftTransaction.count({
        where: {
          tenantId,
          idempotencyKey: `gift:v1:msg_fixed_${testId}`,
        },
      });
      expect(txCount).toBe(1);

      // Verify player received exp exactly once (+300 tu vi)
      const player = await playerRepo.findById(tenantId, joined.player.id);
      expect(player?.currentExp).toBe(300n);
      expect(player?.totalCultivation).toBe(300n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-G10: Event without msgId derives idempotency key from payloadFingerprint / id', async () => {
    const testId = `g10_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    try {
      const persistedEvent = {
        id: `evt_uuid_${testId}`,
        sourceEventId: null, // No upstream msgId
        payloadFingerprint: `sha256_fp_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'rose',
          giftName: 'Rose',
          diamondCount: 1,
          repeatCount: 2,
          totalDiamonds: 2,
          repeatEnd: true,
        },
      };

      const result1 = await giftHandler.handleGift(tenantId, sessionId, persistedEvent, user);
      const result2 = await giftHandler.handleGift(tenantId, sessionId, persistedEvent, user);

      expect(result1.transaction?.status).toBe('applied');
      expect(result2.skipped).toBe(true);
      expect(result2.reason).toBe('ALREADY_PROCESSED');

      const txCount = await prisma.giftTransaction.count({
        where: {
          tenantId,
          idempotencyKey: `gift:v1:sha256_fp_${testId}`,
        },
      });
      expect(txCount).toBe(1);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-G11: Unpriced gift (diamondCount = null) marks transaction as unpriced and skips exp grant', async () => {
    const testId = `g11_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    try {
      const persistedEvent = {
        id: `evt_unpriced_${testId}`,
        sourceEventId: `msg_unpriced_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'custom_unpriced',
          giftName: 'Custom Unpriced',
          diamondCount: null,
          repeatCount: 1,
          totalDiamonds: null,
          repeatEnd: true,
        },
      };

      const result = await giftHandler.handleGift(tenantId, sessionId, persistedEvent, user);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('UNPRICED_GIFT');
      expect(result.transaction?.status).toBe('pending');
      expect(result.transaction?.transactionType).toBe('unpriced');

      // Player exp is unchanged
      const player = await playerRepo.findById(tenantId, joined.player.id);
      expect(player?.currentExp).toBe(0n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-B07: Gift during preparing breakthrough session grants bonus chance BP instead of exp', async () => {
    const testId = `b07_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
      },
    });

    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    // Create an active preparing breakthrough session
    const endsAt = new Date(Date.now() + 30000);
    const btSession = await prisma.breakthroughSession.create({
      data: {
        tenantId,
        playerId: joined.player.id,
        liveSessionId: sessionId,
        sourceRealmOrder: 1,
        targetRealmOrder: 2,
        baseChanceBp: 9000,
        maxChanceBp: 9500,
        bonusDiamonds: 0n,
        giftBonusBp: 0,
        finalChanceBp: 9000,
        status: 'preparing',
        endsAt,
      },
    });

    try {
      const persistedEvent = {
        id: `evt_bt_${testId}`,
        sourceEventId: `msg_bt_${testId}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'crown_10',
          giftName: 'Crown',
          diamondCount: 10,
          repeatCount: 1,
          totalDiamonds: 10,
          repeatEnd: true,
        },
      };

      const result = await giftHandler.handleGift(tenantId, sessionId, persistedEvent, user);

      expect(result.transaction?.status).toBe('applied');
      expect(result.transaction?.transactionType).toBe('breakthrough_bonus');
      expect(result.bonusChanceBp).toBeGreaterThan(0);

      // Check session received bonus diamonds
      const updatedBt = await prisma.breakthroughSession.findUnique({
        where: { tenantId_id: { tenantId, id: btSession.id } },
      });
      expect(updatedBt?.bonusDiamonds).toBe(10n);
      expect(updatedBt?.giftBonusBp).toBeGreaterThan(0);

      // Check player did NOT receive exp
      const player = await playerRepo.findById(tenantId, joined.player.id);
      expect(player?.currentExp).toBe(0n);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.breakthroughSession.deleteMany({ where: { tenantId, id: btSession.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
