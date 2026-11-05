import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GameConfigRepository } from '../../../src/repositories/game/game-config.repository';
import { PlayerRepository } from '../../../src/repositories/game/player.repository';
import { GameEventRepository } from '../../../src/repositories/game/game-event.repository';
import { BreakthroughRepository } from '../../../src/repositories/game/breakthrough.repository';
import { GameConfigService } from '../../../src/services/game/game-config.service';
import { PlayerService } from '../../../src/services/game/player.service';
import { BreakthroughService } from '../../../src/services/game/breakthrough.service';
import { GiftHandler } from '../../../src/services/game/gift-handler';
import { GameEventBus } from '../../../src/services/game/game-event-bus';
import { GameEventProcessor } from '../../../src/services/game/game-event-processor';
import { GameRealtimeGateway } from '../../../src/services/game/game-realtime.gateway';

describe('TU TIEN LIVE — Load & Concurrency Suite (TC-M01 to TC-M03)', () => {
  let prisma: PrismaClient;
  const tenantId = 'a0ad0001-0000-4000-8000-000000000001';
  let sessionId: string;

  let configRepo: GameConfigRepository;
  let configService: GameConfigService;
  let playerRepo: PlayerRepository;
  let eventRepo: GameEventRepository;
  let breakthroughRepo: BreakthroughRepository;
  let playerService: PlayerService;
  let breakthroughService: BreakthroughService;
  let giftHandler: GiftHandler;
  let realtimeGateway: GameRealtimeGateway;
  let eventBus: GameEventBus;
  let processor: GameEventProcessor;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // 1. Setup Tenant
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: { name: 'Tu Tien Load Testing Tenant', status: 'active' },
      create: { id: tenantId, name: 'Tu Tien Load Testing Tenant', status: 'active' },
    });

    // 2. Setup Live Session
    const session = await prisma.liveSession.create({
      data: {
        tenantId,
        creatorUsername: `load_streamer_${Date.now()}`,
        status: 'connected',
      },
    });
    sessionId = session.id;

    // 3. Initialize Services
    configRepo = new GameConfigRepository(prisma);
    configService = new GameConfigService(configRepo);
    playerRepo = new PlayerRepository(prisma);
    eventRepo = new GameEventRepository(prisma);
    breakthroughRepo = new BreakthroughRepository(prisma);
    playerService = new PlayerService(playerRepo, eventRepo, configService);
    realtimeGateway = new GameRealtimeGateway();
    breakthroughService = new BreakthroughService(
      breakthroughRepo,
      playerRepo,
      configService,
      eventRepo
    );
    giftHandler = new GiftHandler(
      prisma,
      configService,
      playerService,
      realtimeGateway
    );
    eventBus = new GameEventBus();
    processor = new GameEventProcessor(
      prisma,
      eventBus,
      giftHandler,
      playerService,
      configService,
      realtimeGateway,
      { concurrency: 16 }
    );
    processor.start();

    // 4. Ensure seed data
    await configRepo.ensureTenantSeeded(tenantId);
    configService.invalidate(tenantId);
    const curCfg = await configService.getConfig(tenantId);
    await configRepo.updateConfigs(
      tenantId,
      { tuViMultiplier: 10, gameEnabled: true, giftProcessingEnabled: true },
      curCfg.revision + 1
    );
    configService.invalidate(tenantId);
  }, 30000);

  afterAll(async () => {
    if (processor) {
      await processor.stop();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function waitForProcessor(timeoutMs = 60000): Promise<void> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    while (Date.now() - start < timeoutMs) {
      const metrics = processor.getMetrics();
      if (metrics.queueSize === 0 && metrics.activeTasks === 0) {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for processor: ${JSON.stringify(processor.getMetrics())}`);
  }

  // TC-M01: 500 người xem tham gia cùng lúc (burst join 500 users) -> 500 game_players, không crash/duplicate
  it('TC-M01: burst join 500 players concurrently without drops or duplicates', async () => {
    const batchSize = 500;
    const usersData = Array.from({ length: batchSize }).map((_, i) => ({
      tenantId,
      platform: 'tiktok',
      uniqueId: `load_cultivator_${Date.now()}_${i}`,
      nickname: `Tu Sĩ Tải Cao #${i}`,
    }));

    // Create 500 users in DB
    await prisma.user.createMany({
      data: usersData,
    });

    const createdUsers = await prisma.user.findMany({
      where: {
        tenantId,
        uniqueId: { startsWith: usersData[0].uniqueId.slice(0, 25) },
      },
      take: batchSize,
    });

    expect(createdUsers).toHaveLength(batchSize);

    // Enqueue all 500 thamgia commands into processor
    for (const user of createdUsers) {
      const event = {
        tenantId,
        sessionId,
        userId: user.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: {
          comment: 'thamgia',
          text: 'thamgia',
          messageId: `join_load_${user.id}`,
        },
      };

      processor.enqueue({
        tenantId,
        sessionId,
        event,
        user,
      });
    }

    // Wait for all 500 commands to be processed through worker queues
    await waitForProcessor(60000);

    // Verify exactly 500 game_player rows created for these users
    const userIds = createdUsers.map((u) => u.id);
    const players = await prisma.gamePlayer.findMany({
      where: {
        tenantId,
        userId: { in: userIds },
      },
    });

    expect(players).toHaveLength(batchSize);

    // Verify 0 duplicates across userIds
    const distinctUserIds = new Set(players.map((p) => p.userId));
    expect(distinctUserIds.size).toBe(batchSize);

    // Verify baseline stats
    for (const p of players) {
      expect(p.realmOrder).toBe(1);
      expect(p.level).toBe(1);
      expect(p.currentExp).toBe(0n);
      expect(p.totalCultivation).toBe(0n);
    }
  }, 60000);

  // TC-M02: 200 gift/s throughput burst -> tổng tu vi nhận được == SUM(diamond * repeat * multiplier), đối soát 100% khớp, 0 duplicate
  it('TC-M02: 200 gift throughput burst reconciles 100% with exact tu vi sum and zero duplicates', async () => {
    // Cancel any breakthrough sessions so all gifts count towards pure cultivation
    await prisma.breakthroughSession.updateMany({
      where: { tenantId, status: { in: ['preparing', 'resolving'] } },
      data: { status: 'cancelled', endedAt: new Date() },
    });

    // Reset gift transactions and player cultivation for clean burst accounting
    await prisma.giftTransaction.deleteMany({
      where: { tenantId },
    });
    await prisma.gamePlayer.updateMany({
      where: { tenantId },
      data: { totalCultivation: 0n, currentExp: 0n, level: 1, realmOrder: 1 },
    });

    // Select 50 existing players
    const samplePlayers = await prisma.gamePlayer.findMany({
      where: { tenantId },
      include: { user: true },
      take: 50,
    });
    expect(samplePlayers.length).toBeGreaterThanOrEqual(50);

    const giftBurstCount = 200;
    const giftTypes = [
      { name: 'Rose', diamonds: 1, id: 'rose' },
      { name: 'Doughnut', diamonds: 30, id: 'doughnut' },
      { name: 'Panda', diamonds: 5, id: 'panda' },
      { name: 'Finger Heart', diamonds: 10, id: 'finger_heart' },
    ];

    let theoreticalSumDiamonds = 0n;
    const tuViMultiplier = 10n;

    // Generate and enqueue 200 gifts across the 50 players
    for (let i = 0; i < giftBurstCount; i++) {
      const player = samplePlayers[i % samplePlayers.length];
      const giftType = giftTypes[i % giftTypes.length];
      const repeatCount = (i % 3) + 1; // 1 to 3
      const diamondsForGift = BigInt(giftType.diamonds * repeatCount);
      theoreticalSumDiamonds += diamondsForGift;

      const event = {
        id: undefined, // no db event id required for fresh unique gift
        sourceEventId: `load_gift_${Date.now()}_${i}_${Math.random()}`,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: giftType.id,
          giftName: giftType.name,
          diamondCount: giftType.diamonds,
          repeatCount,
          totalDiamonds: Number(diamondsForGift),
          repeatEnd: true,
          messageId: `burst_msg_${i}`,
        },
      };

      processor.enqueue({
        tenantId,
        sessionId,
        event,
        user: player.user,
      });
    }

    // Wait for all 200 gifts to settle
    await waitForProcessor(60000);

    // Query all transactions created in this test
    const txAggregate = await prisma.giftTransaction.aggregate({
      where: { tenantId },
      _count: { id: true },
      _sum: { totalDiamonds: true, cultivationReceived: true },
    });

    expect(txAggregate._count.id).toBe(giftBurstCount);
    expect(txAggregate._sum.totalDiamonds).toBe(theoreticalSumDiamonds);

    const expectedTotalTuVi = theoreticalSumDiamonds * tuViMultiplier;
    expect(txAggregate._sum.cultivationReceived).toBe(expectedTotalTuVi);

    // Verify player total cultivation across DB matches the exact expected sum
    const playerAggregate = await prisma.gamePlayer.aggregate({
      where: { tenantId },
      _sum: { totalCultivation: true },
    });

    expect(playerAggregate._sum.totalCultivation).toBe(expectedTotalTuVi);

    // Verify 0 duplicate transactions
    const transactions = await prisma.giftTransaction.findMany({
      where: { tenantId },
      select: { idempotencyKey: true },
    });
    const distinctKeys = new Set(transactions.map((t) => t.idempotencyKey));
    expect(distinctKeys.size).toBe(giftBurstCount);
  }, 60000);

  // TC-M03: 3 nhân vật độ kiếp đồng thời nhận quà bonus -> không race condition, session attribution chính xác
  it('TC-M03: concurrent breakthrough sessions receive bonus gifts without race conditions or attribution leak', async () => {
    // 1. Pick 3 distinct players and set them to LK10
    const testPlayers = await prisma.gamePlayer.findMany({
      where: { tenantId },
      include: { user: true },
      take: 3,
    });
    expect(testPlayers).toHaveLength(3);

    const [p1, p2, p3] = testPlayers;

    // Cancel all stale breakthrough sessions in this tenant from prior tests
    await prisma.breakthroughSession.updateMany({
      where: {
        tenantId,
        status: { in: ['preparing', 'resolving'] },
      },
      data: { status: 'cancelled', endedAt: new Date() },
    });

    for (const p of [p1, p2, p3]) {
      await prisma.gamePlayer.update({
        where: { tenantId_id: { tenantId, id: p.id } },
        data: {
          realmOrder: 1,
          level: 10,
          currentExp: 10000n,
          breakthroughCooldownUntil: null,
        },
      });
    }

    // 2. Start simultaneous breakthrough sessions for all 3 players
    const [sess1, sess2, sess3] = await Promise.all([
      breakthroughService.startBreakthrough(tenantId, p1.id, 'chat', sessionId),
      breakthroughService.startBreakthrough(tenantId, p2.id, 'chat', sessionId),
      breakthroughService.startBreakthrough(tenantId, p3.id, 'chat', sessionId),
    ]);

    expect(sess1.status).toBe('preparing');
    expect(sess2.status).toBe('preparing');
    expect(sess3.status).toBe('preparing');

    // 3. Concurrently send gifts:
    // P1 receives 5 gifts of 10 diamonds = 50 diamonds (+500 bp)
    // P2 receives 5 gifts of 20 diamonds = 100 diamonds (+1000 bp)
    // P3 receives 5 gifts of 30 diamonds = 150 diamonds (+1500 bp)
    const giftsP1 = Array.from({ length: 5 }).map((_, i) => ({
      player: p1,
      diamonds: 10,
      eventId: `gift_p1_${Date.now()}_${i}`,
    }));
    const giftsP2 = Array.from({ length: 5 }).map((_, i) => ({
      player: p2,
      diamonds: 20,
      eventId: `gift_p2_${Date.now()}_${i}`,
    }));
    const giftsP3 = Array.from({ length: 5 }).map((_, i) => ({
      player: p3,
      diamonds: 30,
      eventId: `gift_p3_${Date.now()}_${i}`,
    }));

    const allBonusGifts = [...giftsP1, ...giftsP2, ...giftsP3];

    // Enqueue all gifts concurrently
    for (const g of allBonusGifts) {
      processor.enqueue({
        tenantId,
        sessionId,
        event: {
          sourceEventId: g.eventId,
          eventType: 'gift',
          occurredAt: new Date(),
          data: {
            giftId: 'rose',
            giftName: 'Rose',
            diamondCount: g.diamonds,
            repeatCount: 1,
            totalDiamonds: g.diamonds,
            repeatEnd: true,
            messageId: g.eventId,
          },
        },
        user: g.player.user,
      });
    }

    await waitForProcessor(60000);

    // 4. Assert each session has received exact bonus diamonds without leak
    const [freshSess1, freshSess2, freshSess3] = await Promise.all([
      breakthroughRepo.findById(tenantId, sess1.id),
      breakthroughRepo.findById(tenantId, sess2.id),
      breakthroughRepo.findById(tenantId, sess3.id),
    ]);

    // P1: 50 diamonds -> 500 bp
    expect(freshSess1?.bonusDiamonds).toBe(50n);
    expect(freshSess1?.giftBonusBp).toBe(500);

    // P2: 100 diamonds -> 1000 bp
    expect(freshSess2?.bonusDiamonds).toBe(100n);
    expect(freshSess2?.giftBonusBp).toBe(1000);

    // P3: 150 diamonds -> 1500 bp
    expect(freshSess3?.bonusDiamonds).toBe(150n);
    expect(freshSess3?.giftBonusBp).toBe(1500);

    // Verify finalChanceBp strictly adheres to baseChance + giftBonusBp <= maxChanceBp
    expect(freshSess1?.finalChanceBp).toBe(
      Math.min(freshSess1!.baseChanceBp + freshSess1!.giftBonusBp, freshSess1!.maxChanceBp)
    );
    expect(freshSess2?.finalChanceBp).toBe(
      Math.min(freshSess2!.baseChanceBp + freshSess2!.giftBonusBp, freshSess2!.maxChanceBp)
    );
    expect(freshSess3?.finalChanceBp).toBe(
      Math.min(freshSess3!.baseChanceBp + freshSess3!.giftBonusBp, freshSess3!.maxChanceBp)
    );
  }, 60000);
});
