import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GameConfigRepository } from '../../../src/repositories/game/game-config.repository';
import { PlayerRepository } from '../../../src/repositories/game/player.repository';
import { GameEventRepository } from '../../../src/repositories/game/game-event.repository';
import { GameConfigService } from '../../../src/services/game/game-config.service';
import { PlayerService } from '../../../src/services/game/player.service';
import { GiftHandler } from '../../../src/services/game/gift-handler';
import { GameEventBus } from '../../../src/services/game/game-event-bus';
import { GameEventProcessor } from '../../../src/services/game/game-event-processor';
import { GameRealtimeGateway } from '../../../src/services/game/game-realtime.gateway';

describe('GameEventProcessor — Integration Suite (TC-G08, TC-J01, TC-J02, TC-J08)', () => {
  const prisma = new PrismaClient();
  const tenantId = 'a0000000-0000-0000-0000-000000000001';
  const sessionId = 'b0000000-0000-0000-0000-000000000001';

  let configRepo: GameConfigRepository;
  let configService: GameConfigService;
  let playerRepo: PlayerRepository;
  let eventRepo: GameEventRepository;
  let playerService: PlayerService;
  let giftHandler: GiftHandler;
  let realtimeGateway: GameRealtimeGateway;
  let eventBus: GameEventBus;
  let processor: GameEventProcessor;

  beforeAll(async () => {
    configRepo = new GameConfigRepository(prisma);
    configService = new GameConfigService(configRepo);
    playerRepo = new PlayerRepository(prisma);
    eventRepo = new GameEventRepository(prisma);
    playerService = new PlayerService(playerRepo, eventRepo, configService);
    realtimeGateway = new GameRealtimeGateway();
    giftHandler = new GiftHandler(prisma, configService, playerService, realtimeGateway);
    eventBus = new GameEventBus();
    processor = new GameEventProcessor(
      prisma,
      eventBus,
      giftHandler,
      playerService,
      configService,
      realtimeGateway,
      { concurrency: 8 }
    );

    await configRepo.ensureTenantSeeded(tenantId);
    await prisma.liveSession.upsert({
      where: { tenantId_id: { tenantId, id: sessionId } },
      update: {},
      create: {
        id: sessionId,
        tenantId,
        creatorUsername: 'processor_creator',
        status: 'connected',
      },
    });
  });

  afterAll(async () => {
    await processor.stop();
    await prisma.$disconnect();
  });

  it('TC-G08: 50 concurrent gifts for 1 player process sequentially, total tu vi = theoretical sum, version += 50', async () => {
    const testId = `proc_g08_${Date.now()}`;
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
      // Enqueue 50 concurrent gifts of 2 diamonds each (+20 tu vi each)
      for (let i = 1; i <= 50; i++) {
        processor.enqueue({
          tenantId,
          sessionId,
          event: {
            id: `evt_c_${testId}_${i}`,
            sourceEventId: `msg_c_${testId}_${i}`,
            eventType: 'gift',
            occurredAt: new Date(),
            data: {
              giftId: 'rose',
              giftName: 'Rose',
              diamondCount: 2,
              repeatCount: 1,
              totalDiamonds: 2,
              repeatEnd: true,
            },
          },
          user,
        });
      }

      // Wait for processor to drain
      await processor.stop();

      // Check player in DB: 50 * 20 = 1,000 tu vi
      const player = await playerRepo.findById(tenantId, joined.player.id);
      expect(player?.totalCultivation).toBe(1000n);
      expect(player?.totalDiamondsGifted).toBe(100n);
      expect(player?.version).toBe(50); // version incremented exactly 50 times

      // Check gift_transactions: exactly 50 rows
      const txCount = await prisma.giftTransaction.count({
        where: { tenantId, userId: user.id, status: 'applied' },
      });
      expect(txCount).toBe(50);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-J01 & TC-J02: Enqueuing chat "thamgia" creates player; subsequent "thamgia" returns same player', async () => {
    const testId = `proc_j01_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
        nickname: 'Chat Joiner',
      },
    });

    try {
      // 1. First chat message: "thamgia"
      processor.enqueue({
        tenantId,
        sessionId,
        event: {
          id: `evt_chat_1_${testId}`,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { text: 'thamgia' },
        },
        user,
      });

      await processor.stop();

      // Player created
      const player1 = await playerRepo.findByUserId(tenantId, user.id);
      expect(player1).not.toBeNull();
      expect(player1?.realmOrder).toBe(1);
      expect(player1?.level).toBe(1);

      // Verify game_event player_joined
      const joinEvent = await prisma.gameEvent.findFirst({
        where: { tenantId, playerId: player1!.id, eventType: 'player_joined' },
      });
      expect(joinEvent).not.toBeNull();

      // 2. Second chat message: "tham gia" (returning player)
      processor.enqueue({
        tenantId,
        sessionId,
        event: {
          id: `evt_chat_2_${testId}`,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { text: 'tham gia' },
        },
        user,
      });

      await processor.stop();

      // Player count is still 1
      const count = await prisma.gamePlayer.count({
        where: { tenantId, userId: user.id },
      });
      expect(count).toBe(1);

      // Verify game_event player_returned
      const returnEvent = await prisma.gameEvent.findFirst({
        where: { tenantId, playerId: player1!.id, eventType: 'player_returned' },
      });
      expect(returnEvent).not.toBeNull();
    } finally {
      await prisma.gameEvent.deleteMany({ where: { tenantId, player: { userId: user.id } } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('TC-J08: Changing gender twice within 24h emits command_rejected', async () => {
    const testId = `proc_j08_${Date.now()}`;
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
    }, 'male');

    try {
      // 1. Change gender to female: should succeed
      processor.enqueue({
        tenantId,
        sessionId,
        event: {
          id: `evt_g_1_${testId}`,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { text: 'gioitinh nu' },
        },
        user,
      });
      await processor.stop();

      const playerAfter1 = await playerRepo.findById(tenantId, joined.player.id);
      expect(playerAfter1?.gender).toBe('female');

      // 2. Change gender back to male immediately: should be rejected due to 24h cooldown
      processor.enqueue({
        tenantId,
        sessionId,
        event: {
          id: `evt_g_2_${testId}`,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { text: 'gioitinh nam' },
        },
        user,
      });
      await processor.stop();

      const playerAfter2 = await playerRepo.findById(tenantId, joined.player.id);
      expect(playerAfter2?.gender).toBe('female'); // still female

      // Verify command_rejected event
      const rejected = await prisma.gameEvent.findFirst({
        where: {
          tenantId,
          playerId: joined.player.id,
          eventType: 'command_rejected',
        },
      });
      expect(rejected).not.toBeNull();
      expect((rejected?.payload as any)?.reason).toContain('24 giờ');
    } finally {
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('tracks processor metrics (queueSize, lag, totalProcessed)', () => {
    const metrics = processor.getMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.queueSize).toBe('number');
    expect(typeof metrics.processorLagMs).toBe('number');
    expect(typeof metrics.totalProcessed).toBe('number');
    expect(metrics.totalProcessed).toBeGreaterThan(0);
    expect(metrics.isBackpressureActive).toBe(false);
  });
});
