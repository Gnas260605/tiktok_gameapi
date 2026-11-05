import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../../src/app';
import { AuthService } from '../../../src/services/auth/auth.service';
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
import { GameReconcilerService } from '../../../src/services/game/game-reconciler.service';

describe('TU TIEN LIVE — E2E Acceptance Test Suite (AC-01 to AC-14)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantId = 'e2e00001-0000-4000-8000-000000000001';
  const overlayApiKey = 'tik_live_e2e_overlay_key_12345';
  const adminApiKey = 'tik_live_e2e_admin_key_12345';

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
  let reconciler: GameReconcilerService;

  let sessionId: string;
  let testPlayerId: string;
  let testUserId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    // 1. Setup Tenant
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: { name: 'Tu Tien E2E Acceptance Tenant', status: 'active' },
      create: { id: tenantId, name: 'Tu Tien E2E Acceptance Tenant', status: 'active' },
    });

    // 2. Setup Scoped API Keys
    const prefixOvr = 'tik_live_e2e_ovr';
    const prefixAdm = 'tik_live_e2e_adm';
    await prisma.apiKey.deleteMany({
      where: { tenantId, keyPrefix: { in: [prefixOvr, prefixAdm] } },
    });

    await prisma.apiKey.createMany({
      data: [
        {
          tenantId,
          name: 'E2E Overlay Key',
          keyPrefix: prefixOvr,
          keyHash: AuthService.hashKey(overlayApiKey),
          scopes: ['game:overlay'],
          status: 'active',
        },
        {
          tenantId,
          name: 'E2E Admin Key',
          keyPrefix: prefixAdm,
          keyHash: AuthService.hashKey(adminApiKey),
          scopes: ['game:admin', '*'], // Include wildcard for live session control
          status: 'active',
        },
      ],
    });

    // 3. Initialize Repositories and Services
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
      { concurrency: 8 }
    );
    processor.start();
    reconciler = new GameReconcilerService(prisma, processor, { lookbackHours: 24 });

    // 4. Ensure Tu Tien Realm and Levels Seeded
    await configRepo.ensureTenantSeeded(tenantId);
    configService.invalidate(tenantId);
    const curCfg = await configService.getConfig(tenantId);
    await configRepo.updateConfigs(tenantId, { tuViMultiplier: 10 }, curCfg.revision + 1);
    configService.invalidate(tenantId);
  });

  async function waitForProcessor(): Promise<void> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    while (Date.now() - start < 5000) {
      const metrics = processor.getMetrics();
      if (metrics.queueSize === 0 && metrics.activeTasks === 0) {
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function processCanonicalEvent(
    tId: string,
    sId: string,
    event: any,
    user: any
  ): Promise<void> {
    processor.enqueue({ tenantId: tId, sessionId: sId, event, user });
    await waitForProcessor();
  }

  afterAll(async () => {
    await processor.stop();
    await app.close();
    await prisma.$disconnect();
  });

  // AC-01: Kết nối LIVE giả lập MockConnector thành công
  it('AC-01: establishes mock LIVE stream session successfully', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/live/sessions',
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
        'Content-Type': 'application/json',
      },
      payload: {
        creatorUsername: 'streamer_tutien_master',
        mode: 'mock',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.creatorUsername).toBe('streamer_tutien_master');

    sessionId = body.data.id;

    // Verify session persisted in DB
    const dbSession = await prisma.liveSession.findUnique({
      where: { tenantId_id: { tenantId, id: sessionId } },
    });
    expect(dbSession).not.toBeNull();
  });

  // AC-02: Người xem tham gia bằng username (lệnh tham gia / nhap mon, chọn giới tính)
  it('AC-02: player joins cultivation sect via command with gender selection', async () => {
    const uniqueHandle = `cultivator_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: uniqueHandle,
        nickname: 'Nữ Tu Sĩ Bạch Liên',
      },
    });
    testUserId = user.id;

    // Chat command: "thamgia nu"
    const event = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: {
          comment: 'thamgia nu',
          text: 'thamgia nu',
          messageId: `msg_${Date.now()}`,
        },
      },
    });

    await processCanonicalEvent(tenantId, sessionId, event, user);

    const player = await playerRepo.findByUserId(tenantId, user.id);
    expect(player).not.toBeNull();
    expect(player?.username).toBe(uniqueHandle);
    expect(player?.gender).toBe('female');
    expect(player?.realmOrder).toBe(1); // Luyện Khí
    expect(player?.level).toBe(1); // Tầng 1
    expect(player?.currentExp).toBe(0n);
    expect(player?.totalCultivation).toBe(0n);

    testPlayerId = player!.id;

    // Verify player_joined event emitted
    const joinedEvents = await prisma.gameEvent.findMany({
      where: { tenantId, playerId: testPlayerId, eventType: 'player_joined' },
    });
    expect(joinedEvents.length).toBeGreaterThanOrEqual(1);
  });

  // AC-03: Nhân vật lưu trữ bền vững trong PostgreSQL qua các lần session/server restart
  it('AC-03: player profile persists across stream sessions and restart', async () => {
    // Simulate user rejoining in a new session
    const newSession = await prisma.liveSession.create({
      data: {
        tenantId,
        creatorUsername: `streamer_restarted_${Date.now()}`,
        status: 'connected',
      },
    });

    const user = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(user).not.toBeNull();

    // Rejoining command
    const rejoinEvent = await prisma.event.create({
      data: {
        tenantId,
        sessionId: newSession.id,
        userId: user!.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { comment: 'tham gia', text: 'tham gia' },
      },
    });

    await processCanonicalEvent(tenantId, newSession.id, rejoinEvent, user);

    // Profile remains the same, not duplicated
    const players = await prisma.gamePlayer.findMany({
      where: { tenantId, userId: user!.id },
    });
    expect(players).toHaveLength(1);
    expect(players[0].id).toBe(testPlayerId);
  });

  // AC-04: Quà tặng TikTok Live quy đổi chính xác thành tu vi (10x hệ số)
  it('AC-04: converts gifts into tu vi exp using configured 10x multiplier', async () => {
    const user = await prisma.user.findUnique({ where: { id: testUserId } });
    const diamondCount = 30; // Doughnut (30 💎)
    const repeatCount = 2; // Total 60 💎 -> 600 tu vi

    const giftEvent = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user!.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'doughnut',
          giftName: 'Doughnut',
          diamondCount,
          repeatCount,
          totalDiamonds: diamondCount * repeatCount,
          repeatEnd: true,
          messageId: `gift_msg_${Date.now()}`,
        },
      },
    });

    await processCanonicalEvent(tenantId, sessionId, giftEvent, user);

    // Verify gift_transactions
    const tx = await prisma.giftTransaction.findFirst({
      where: { tenantId, eventId: giftEvent.id },
    });
    expect(tx).not.toBeNull();
    expect(tx?.status).toBe('applied');
    expect(tx?.transactionType).toBe('cultivation');
    expect(tx?.cultivationReceived).toBe(600n);

    // Verify player tu vi
    const player = await playerRepo.findById(tenantId, testPlayerId);
    expect(player?.currentExp).toBe(600n);
    expect(player?.totalCultivation).toBe(600n);
  });

  // AC-05: Đủ 8 cảnh giới x 10 tầng (80 tầng)
  it('AC-05: seeds and exposes all 8 cultivation realms and 80 levels', async () => {
    const realms = await prisma.cultivationRealm.findMany({
      where: { tenantId },
      orderBy: { realmOrder: 'asc' },
    });
    expect(realms).toHaveLength(8);

    const levels = await prisma.cultivationLevel.findMany({
      where: { tenantId },
      orderBy: [{ realmOrder: 'asc' }, { level: 'asc' }],
    });
    expect(levels).toHaveLength(80);

    // Realm 1 (Luyện Khí): level 1 = 1000, level 10 = 10000
    const lk1 = levels.find((l) => l.realmOrder === 1 && l.level === 1);
    const lk10 = levels.find((l) => l.realmOrder === 1 && l.level === 10);
    expect(lk1?.requiredExp).toBe(1000n);
    expect(lk10?.requiredExp).toBe(10000n);
  });

  // AC-06: Tự động lên tầng (kể cả multi-level jumps khi nhận quà lớn) và dừng lại ở tầng 10 đỉnh phong
  it('AC-06: automatically levels up with multi-level jump and stops at level 10 peak', async () => {
    const user = await prisma.user.findUnique({ where: { id: testUserId } });

    // Send massive Galaxy gift (1,000 diamonds = 10,000 tu vi)
    const galaxyEvent = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user!.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'galaxy',
          giftName: 'Galaxy',
          diamondCount: 1000,
          repeatCount: 1,
          totalDiamonds: 1000,
          repeatEnd: true,
          messageId: `galaxy_${Date.now()}`,
        },
      },
    });

    await processCanonicalEvent(tenantId, sessionId, galaxyEvent, user);

    let player = await playerRepo.findById(tenantId, testPlayerId);
    expect(player?.level).toBeGreaterThan(1);

    // Push player directly to Level 10 (Đại Viên Mãn) with Lion gift (29,999 diamonds = 299,990 exp)
    const lionEvent = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user!.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'lion',
          giftName: 'Lion',
          diamondCount: 29999,
          repeatCount: 1,
          totalDiamonds: 29999,
          repeatEnd: true,
          messageId: `lion_${Date.now()}`,
        },
      },
    });

    await processCanonicalEvent(tenantId, sessionId, lionEvent, user);

    player = await playerRepo.findById(tenantId, testPlayerId);
    // Must stop at Level 10 of Realm 1, never auto-advance to Realm 2
    expect(player?.realmOrder).toBe(1);
    expect(player?.level).toBe(10);

    // Max overflow cap in LK is 3.0 * req(10) = 30,000 surplus, total currentExp capped at 40,000n
    expect(player?.currentExp).toBe(40000n);
  });

  // AC-07: Độ kiếp thành công (tăng cảnh giới, chuyển tu vi dư) và thất bại (phạt 20% tu vi dư, hồi chiêu 300s)
  it('AC-07: resolves breakthrough outcome correctly for both failure and success', async () => {
    // 1. Test Failure
    const failSession = await breakthroughService.startBreakthrough(tenantId, testPlayerId, 'chat');
    expect(failSession.status).toBe('preparing');

    // Force deterministic failure with roll = 9999 (>= finalChance)
    const failOutcome = await breakthroughService.resolveBreakthrough(
      tenantId,
      failSession.id,
      () => 9999
    );

    expect(failOutcome?.result).toBe('failure');
    expect(failOutcome?.session.status).toBe('failed');

    let player = await playerRepo.findById(tenantId, testPlayerId);
    expect(player?.realmOrder).toBe(1);
    expect(player?.level).toBe(10);
    // 20% penalty applied on 30,000 surplus = 6,000 penalty. currentExp becomes 34,000n
    expect(player?.currentExp).toBe(34000n);
    expect(player?.breakthroughCooldownUntil).not.toBeNull();

    // 2. Clear cooldown for testing success
    await prisma.gamePlayer.update({
      where: { tenantId_id: { tenantId, id: testPlayerId } },
      data: { breakthroughCooldownUntil: null },
    });

    // 3. Test Success
    const successSession = await breakthroughService.startBreakthrough(tenantId, testPlayerId, 'chat');
    expect(successSession.status).toBe('preparing');

    // Force deterministic success with roll = 0 (< finalChance)
    const successOutcome = await breakthroughService.resolveBreakthrough(
      tenantId,
      successSession.id,
      () => 0
    );

    expect(successOutcome?.result).toBe('success');
    expect(successOutcome?.session.status).toBe('succeeded');

    player = await playerRepo.findById(tenantId, testPlayerId);
    // Promoted to Realm 2 (Trúc Cơ)
    expect(player?.realmOrder).toBe(2);
    expect(player?.breakthroughSuccessCount).toBe(1);
    // Surplus exp carried over to Trúc Cơ
    expect(player?.currentExp).toBeGreaterThanOrEqual(0n);
  });

  // AC-08: Quà tặng trong 30s độ kiếp cộng dồn bonus tỷ lệ thành công, chặn trần nghiêm ngặt ở 95% (9500 bp)
  it('AC-08: accumulates gift bonus chance during preparation window and enforces 95% cap', async () => {
    // Reset player back to LK10 to test breakthrough gift bonus window
    await prisma.gamePlayer.update({
      where: { tenantId_id: { tenantId, id: testPlayerId } },
      data: {
        realmOrder: 1,
        level: 10,
        currentExp: 15000n,
        breakthroughCooldownUntil: null,
      },
    });

    const session = await breakthroughService.startBreakthrough(tenantId, testPlayerId, 'chat');
    expect(session.status).toBe('preparing');

    const user = await prisma.user.findUnique({ where: { id: testUserId } });

    // Gift within 30s window (10 diamonds)
    const bonusGift1 = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user!.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'rose',
          giftName: 'Rose',
          diamondCount: 10,
          repeatCount: 1,
          totalDiamonds: 10,
          repeatEnd: true,
          messageId: `bgift_1_${Date.now()}`,
        },
      },
    });

    await processCanonicalEvent(tenantId, sessionId, bonusGift1, user);

    let updatedSession = await breakthroughRepo.findById(tenantId, session.id);
    expect(updatedSession?.bonusDiamonds).toBe(10n);
    expect(updatedSession?.giftBonusBp).toBe(100); // 10 diamonds * 10 bp/diamond = 100 bp

    // Large gift (1,000 diamonds) -> caps at 9500 bp (95%)
    const bonusGift2 = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user!.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'galaxy',
          giftName: 'Galaxy',
          diamondCount: 1000,
          repeatCount: 1,
          totalDiamonds: 1000,
          repeatEnd: true,
          messageId: `bgift_2_${Date.now()}`,
        },
      },
    });

    await processCanonicalEvent(tenantId, sessionId, bonusGift2, user);

    updatedSession = await breakthroughRepo.findById(tenantId, session.id);
    const finalChance = Math.min(
      updatedSession!.baseChanceBp + updatedSession!.giftBonusBp,
      updatedSession!.maxChanceBp
    );
    expect(finalChance).toBe(9500); // strictly capped at 9500 bp
  });

  // AC-09: Frame WebSocket breakthrough.resolved mang tài nguyên nhân vật mới theo cảnh giới
  it('AC-09: broadcast frame breakthrough.resolved contains updated realm character asset', async () => {
    // 1. Resolve active breakthrough session with success
    const session = await prisma.breakthroughSession.findFirst({
      where: { tenantId, playerId: testPlayerId, status: 'preparing' },
    });
    expect(session).not.toBeNull();

    await breakthroughService.resolveBreakthrough(tenantId, session!.id, () => 0);

    // 2. Fetch the newly emitted breakthrough_succeeded event
    const successEvent = await prisma.gameEvent.findFirst({
      where: { tenantId, eventType: 'breakthrough_succeeded' },
      orderBy: { seq: 'desc' },
    });
    expect(successEvent).not.toBeNull();

    // 3. Test realtime gateway frame mapping and character asset
    let capturedFrame: any = null;
    const testGateway = new GameRealtimeGateway({
      broadcastGameFrame: (_tId: string, _sId: string, frame: any) => {
        if (frame.event === 'breakthrough.resolved') {
          capturedFrame = frame;
        }
      },
    });

    testGateway.broadcastFromGameEvent(tenantId, sessionId, successEvent!);
    expect(capturedFrame).toBeDefined();
    expect(capturedFrame.event).toBe('breakthrough.resolved');
    expect(capturedFrame.data.result).toBe('success');
    expect(capturedFrame.data.newRealmOrder).toBe(2);

    // 4. Verify female character asset for Realm 2 (Trúc Cơ)
    const realm2 = await prisma.cultivationRealm.findUnique({
      where: { tenantId_realmOrder: { tenantId, realmOrder: 2 } },
    });
    expect(realm2).not.toBeNull();
    expect(realm2?.characterFemaleAsset).toBeDefined();
    expect(realm2?.characterFemaleAsset.length).toBeGreaterThan(0);
  });

  // AC-10: Các frame sự kiện quà tặng và độ kiếp phát sóng realtime chuẩn xác
  it('AC-10: emits sequenced game frames for exp gains and breakthrough events', async () => {
    const gameEvents = await prisma.gameEvent.findMany({
      where: { tenantId },
      orderBy: { seq: 'desc' },
      take: 10,
    });

    expect(gameEvents.length).toBeGreaterThan(0);
    // Monotonic sequence verification
    for (let i = 0; i < gameEvents.length - 1; i++) {
      expect(gameEvents[i].seq).toBeGreaterThan(gameEvents[i + 1].seq);
    }
  });

  // AC-11: Overlay API (/api/v1/game/state) và 5 bảng xếp hạng hoạt động chuẩn
  it('AC-11: queries game state and all 5 leaderboards via REST API', async () => {
    // 1. Overlay Game State
    const stateRes = await app.inject({
      method: 'GET',
      url: `/api/v1/game/state?liveSessionId=${sessionId}`,
      headers: { Authorization: `Bearer ${overlayApiKey}` },
    });
    expect(stateRes.statusCode).toBe(200);
    const stateBody = stateRes.json();
    expect(stateBody.success).toBe(true);
    expect(stateBody.data.flags).toBeDefined();
    expect(stateBody.data.leaderboards).toBeDefined();

    // 2. Leaderboards
    const boards = ['realm', 'level', 'cultivation', 'breakthrough', 'gifts'];
    for (const board of boards) {
      const lbRes = await app.inject({
        method: 'GET',
        url: `/api/v1/game/leaderboards/${board}`,
        headers: { Authorization: `Bearer ${overlayApiKey}` },
      });
      expect(lbRes.statusCode).toBe(200);
      const lbBody = lbRes.json();
      expect(lbBody.success).toBe(true);
      expect(Array.isArray(lbBody.data.entries)).toBe(true);
    }
  });

  // AC-12: Streamer Admin API
  it('AC-12: supports admin config update, player adjustment, reset with confirmUsername, and audit logging', async () => {
    // 1. Update config with baseRevision fetched via GET /api/v1/game/admin/config
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/game/admin/config',
      headers: { Authorization: `Bearer ${adminApiKey}` },
    });
    expect(getRes.statusCode).toBe(200);
    const currentConfig = getRes.json().data;

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/game/admin/config',
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
        'Content-Type': 'application/json',
      },
      payload: {
        baseRevision: currentConfig.revision,
        values: {
          tuViMultiplier: 12,
        },
      },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().data.values.tuViMultiplier).toBe(12);

    // 2. Adjust player with required reason and expectedVersion
    const player = await playerRepo.findById(tenantId, testPlayerId);
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/game/admin/players/${testPlayerId}`,
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
        'Content-Type': 'application/json',
      },
      payload: {
        expectedVersion: player!.version,
        currentExp: '5000',
        reason: 'E2E admin bonus',
      },
    });
    expect(patchRes.statusCode).toBe(200);

    // 3. Reset player requiring confirmUsername
    const resetRes = await app.inject({
      method: 'POST',
      url: `/api/v1/game/admin/players/${testPlayerId}/reset`,
      headers: {
        Authorization: `Bearer ${adminApiKey}`,
        'Content-Type': 'application/json',
      },
      payload: {
        confirmUsername: player!.username,
        reason: 'E2E admin reset test',
      },
    });
    expect(resetRes.statusCode).toBe(200);
    const resetPlayer = resetRes.json().data;
    expect(resetPlayer.realmOrder).toBe(1);
    expect(resetPlayer.level).toBe(1);

    // 4. Verify admin audit logs
    const auditLogs = await prisma.adminAuditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(3);
  });

  // AC-13: Khử trùng lặp quà tuyệt đối (0 giao dịch trùng lặp khi publish lại cùng 1 event)
  it('AC-13: guarantees zero duplicate gift transactions when publishing identical event repeatedly', async () => {
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: `dedup_${Date.now()}`,
        nickname: 'Dedup Tester',
      },
    });

    const fixedMsgId = `stable_msg_${Date.now()}`;
    const giftEvent = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'rose',
          giftName: 'Rose',
          diamondCount: 1,
          repeatCount: 1,
          totalDiamonds: 1,
          repeatEnd: true,
          messageId: fixedMsgId,
        },
      },
    });

    // Process the exact same event 30 times concurrently
    await Promise.all(
      Array.from({ length: 30 }).map(() =>
        giftHandler.handleGift(tenantId, sessionId, giftEvent, user)
      )
    );

    // Assert exactly 1 transaction created
    const txCount = await prisma.giftTransaction.count({
      where: { tenantId, eventId: giftEvent.id },
    });
    expect(txCount).toBe(1);
  });

  // AC-14: Không mất dữ liệu quà tặng khi server khởi động lại (Reconciler quét bù quà 24h)
  it('AC-14: reconciler detects and recovers missing gifts unhandled prior to crash', async () => {
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: `reconcile_${Date.now()}`,
        nickname: 'Reconciler Tester',
      },
    });

    // Create an unhandled gift event in events table (mimicking crash before processor ran)
    const unhandledEvent = await prisma.event.create({
      data: {
        tenantId,
        sessionId,
        userId: user.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: 'doughnut',
          giftName: 'Doughnut',
          diamondCount: 30,
          repeatCount: 1,
          totalDiamonds: 30,
          repeatEnd: true,
          messageId: `unhandled_${Date.now()}`,
        },
      },
    });

    // Trigger 24h reconciliation scan
    const recoveredCount = await reconciler.reconcile(tenantId);
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    await waitForProcessor();

    // Verify transaction created
    const tx = await prisma.giftTransaction.findFirst({
      where: { tenantId, eventId: unhandledEvent.id },
    });
    expect(tx).not.toBeNull();
    expect(tx?.status).toBe('applied');
  });
});
