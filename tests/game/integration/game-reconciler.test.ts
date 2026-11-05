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
import { GameReconcilerService } from '../../../src/services/game/game-reconciler.service';
import { GameRealtimeGateway } from '../../../src/services/game/game-realtime.gateway';

describe('GameReconcilerService — Recovery Integration Tests (TC-G13)', () => {
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
  let reconciler: GameReconcilerService;

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
      realtimeGateway
    );
    reconciler = new GameReconcilerService(prisma, processor, { lookbackHours: 24 });

    await configRepo.ensureTenantSeeded(tenantId);
    await prisma.liveSession.upsert({
      where: { tenantId_id: { tenantId, id: sessionId } },
      update: {},
      create: {
        id: sessionId,
        tenantId,
        creatorUsername: 'reconcile_creator',
        status: 'connected',
      },
    });
  });

  afterAll(async () => {
    await processor.stop();
    reconciler.stop();
    await prisma.$disconnect();
  });

  it('TC-G13: Reconciler scans missed gift events within 24h and processes them idempotently', async () => {
    const testId = `reconcile_${Date.now()}`;

    // 1. Create a user
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testId,
        nickname: 'Reconcile User',
      },
    });

    // 2. Pre-join player
    const joined = await playerService.joinOrReturn(tenantId, {
      id: user.id,
      username: testId,
    });

    // 3. Insert a gift event directly into `events` table that was NOT processed (simulating server crash)
    const rawGiftEvent = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user.id,
        eventType: 'gift',
        sourceEventId: `msg_${testId}`,
        occurredAt: new Date(),
        data: {
          giftId: 'rose_reconcile',
          giftName: 'Rose',
          diamondCount: 1,
          repeatCount: 10,
          totalDiamonds: 10,
          repeatEnd: true,
        },
      },
    });

    try {
      // 4. Verify no gift_transactions exist yet
      const countBefore = await prisma.giftTransaction.count({
        where: {
          tenantId,
          eventId: rawGiftEvent.id,
        },
      });
      expect(countBefore).toBe(0);

      // 5. Run reconciliation sweep
      const reEnqueued = await reconciler.reconcile(tenantId);
      expect(reEnqueued).toBeGreaterThanOrEqual(1);

      // 6. Stop processor to drain all queues
      await processor.stop();

      // 7. Verify in DB: exactly 1 gift_transactions row was created and applied
      const tx = await prisma.giftTransaction.findFirst({
        where: {
          tenantId,
          eventId: rawGiftEvent.id,
        },
      });

      expect(tx).not.toBeNull();
      expect(tx?.status).toBe('applied');
      expect(tx?.cultivationReceived).toBe(100n); // 10 diamonds * 10 multiplier

      // Verify player received exp
      const player = await playerRepo.findById(tenantId, joined.player.id);
      expect(player?.currentExp).toBe(100n);

      // 8. Run reconciliation again: should find 0 unhandled events
      const reEnqueuedSecond = await reconciler.reconcile(tenantId);
      expect(reEnqueuedSecond).toBe(0);
    } finally {
      await prisma.giftTransaction.deleteMany({ where: { tenantId, userId: user.id } });
      await prisma.gameEvent.deleteMany({ where: { tenantId, playerId: joined.player.id } });
      await prisma.event.deleteMany({ where: { tenantId, id: rawGiftEvent.id } });
      await prisma.gamePlayer.deleteMany({ where: { tenantId, id: joined.player.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
