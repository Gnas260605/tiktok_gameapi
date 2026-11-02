import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Tenant } from '@prisma/client';
import {
  TenantRepository,
  SessionRepository,
  UserRepository,
  EventRepository,
} from '../../src/repositories';
import { EventIngestionService } from '../../src/services/event/event-ingestion.service';
import { UserNormalizationService } from '../../src/services/user/user-normalization.service';
import { MockConnector, FIXTURE_USERS } from '../../src/adapters/tiktok';

describe('Milestone 2: Connector Subsystem & Event Ingestion Integration Suite', () => {
  let prisma: PrismaClient;
  let tenantRepo: TenantRepository;
  let sessionRepo: SessionRepository;
  let userRepo: UserRepository;
  let eventRepo: EventRepository;
  let userNormService: UserNormalizationService;
  let ingestionService: EventIngestionService;

  let tenantA: Tenant;
  let tenantB: Tenant;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    tenantRepo = new TenantRepository(prisma);
    sessionRepo = new SessionRepository(prisma);
    userRepo = new UserRepository(prisma);
    eventRepo = new EventRepository(prisma);
    userNormService = new UserNormalizationService();

    ingestionService = new EventIngestionService(
      sessionRepo,
      userRepo,
      eventRepo,
      userNormService,
      undefined,
      { dedupTtlMs: 60000 }
    );

    tenantA = await tenantRepo.create({ name: 'M2 Test Tenant Alpha', status: 'active' });
    tenantB = await tenantRepo.create({ name: 'M2 Test Tenant Beta', status: 'active' });
  });

  afterAll(async () => {
    if (tenantA) await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => {});
    if (tenantB) await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => {});
    ingestionService.destroy();
    await prisma.$disconnect();
  });

  it('Scenario 1: MockConnector connection lifecycle (queued -> connecting -> connected -> disconnected)', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_lifecycle_sc1',
    });
    expect(session.status).toBe('queued');

    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);

    const connectResult = await connector.connect('streamer_lifecycle_sc1', {
      sessionId: session.id,
      tenantId: tenantA.id,
    });
    expect(connectResult.success).toBe(true);
    expect(connectResult.status).toBe('connected');

    await ingestionService.waitForPending();

    const connectedSession = await sessionRepo.findById(tenantA.id, session.id);
    expect(connectedSession?.status).toBe('connected');
    expect(connectedSession?.startedAt).not.toBeNull();
    expect(connectedSession?.roomId).toBeDefined();

    await connector.disconnect('USER_STOPPED_STREAM');
    await ingestionService.waitForPending();

    const disconnectedSession = await sessionRepo.findById(tenantA.id, session.id);
    expect(disconnectedSession?.status).toBe('disconnected');
    expect(disconnectedSession?.disconnectReason).toBe('USER_STOPPED_STREAM');
    expect(disconnectedSession?.endedAt).not.toBeNull();

    sub.unsubscribe();
  });

  it('Scenario 2: Ingestion of member event and Tier 1 user upsert', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc2_member',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc2_member', { sessionId: session.id, tenantId: tenantA.id });

    connector.simulateMember(
      {
        platformUserId: 'sc2_platform_user_1001',
        uniqueId: 'member_john',
        nickname: 'Member John',
        avatarUrl: 'https://p16.tiktokcdn.com/john.jpeg',
      },
      'enter_room'
    );

    await ingestionService.waitForPending();

    // Verify user upserted with Tier 1 platform_id
    const user = await prisma.user.findFirst({
      where: { tenantId: tenantA.id, platformUserId: 'sc2_platform_user_1001' },
    });
    expect(user).toBeDefined();
    expect(user?.identityQuality).toBe('platform_id');
    expect(user?.uniqueId).toBe('member_john');
    expect(user?.nickname).toBe('Member John');

    // Verify canonical event in DB
    const events = await eventRepo.listBySession(tenantA.id, session.id);
    const memberEvt = events.items.find((e) => e.eventType === 'member');
    expect(memberEvt).toBeDefined();
    expect(memberEvt?.userId).toBe(user?.id);
    expect((memberEvt?.data as any).joinMethod).toBe('enter_room');

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 3: Ingestion of chat event with emojis and special characters', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc3_chat',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc3_chat', { sessionId: session.id, tenantId: tenantA.id });

    const complexComment = '🔥 Live stream! <script>alert("xss")</script> & unicode 💖🎉 Let’s go!';

    connector.simulateChat(complexComment, {
      platformUserId: 'sc3_user_1002',
      uniqueId: 'emoji_fanatic',
      nickname: 'Emoji King 👑',
    });

    await ingestionService.waitForPending();

    const events = await eventRepo.listBySession(tenantA.id, session.id);
    const chatEvt = events.items.find((e) => e.eventType === 'chat');
    expect(chatEvt).toBeDefined();
    expect((chatEvt?.data as any).comment).toBe(complexComment);
    expect((chatEvt?.data as any).text).toBe(complexComment);

    const user = await prisma.user.findFirst({
      where: { tenantId: tenantA.id, platformUserId: 'sc3_user_1002' },
    });
    expect(user).toBeDefined();
    expect(user?.nickname).toBe('Emoji King 👑');

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 4: Ingestion of gift event with streak tracking, diamond accumulation, and user metrics update', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc4_gifts',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc4_gifts', { sessionId: session.id, tenantId: tenantA.id });

    const gifter = {
      platformUserId: 'sc4_gifter_1003',
      uniqueId: 'diamond_donor',
      nickname: 'Big Donator',
    };

    // Gift 1: 1 Rose (1 diamond) - streak start
    connector.simulateGift('Rose', 1, 1, false, gifter);
    // Gift 2: 10 Roses (1 diamond * 10 = 10 diamonds) - streak end
    connector.simulateGift('Rose', 1, 10, true, gifter);
    // Gift 3: 2 Doughnuts (30 diamonds * 2 = 60 diamonds)
    connector.simulateGift('Doughnut', 30, 2, true, gifter);

    await ingestionService.waitForPending();

    const events = await eventRepo.listBySession(tenantA.id, session.id);
    const giftEvents = events.items.filter((e) => e.eventType === 'gift');
    expect(giftEvents.length).toBe(3);

    const dbUser = await prisma.user.findFirst({
      where: { tenantId: tenantA.id, platformUserId: 'sc4_gifter_1003' },
    });
    expect(dbUser).toBeDefined();

    // Check in-memory user metrics
    const userStats = ingestionService.getUserSessionStats(session.id, dbUser!.id);
    expect(userStats).toBeDefined();
    expect(userStats?.giftCount).toBe(3);
    // Total diamonds = 1*1 + 1*10 + 30*2 = 71
    expect(userStats?.totalDiamonds).toBe(71);

    // Check session aggregate stats
    const sessionStats = ingestionService.getSessionStats(session.id);
    expect(sessionStats?.totalDiamonds).toBe(71);

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 5: Ingestion of like event with batch deltas', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc5_likes',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc5_likes', { sessionId: session.id, tenantId: tenantA.id });

    connector.simulateLike(25, 1500, {
      platformUserId: 'sc5_liker_1004',
      uniqueId: 'turbo_tapper',
      nickname: 'Turbo Tapper',
    });

    await ingestionService.waitForPending();

    const events = await eventRepo.listBySession(tenantA.id, session.id);
    const likeEvt = events.items.find((e) => e.eventType === 'like');
    expect(likeEvt).toBeDefined();
    expect((likeEvt?.data as any).likeCount).toBe(25);
    expect((likeEvt?.data as any).totalLikes).toBe(1500);

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 6: Ingestion of follow and share events', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc6_social',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc6_social', { sessionId: session.id, tenantId: tenantA.id });

    // Follow event
    connector.simulateFollow({
      platformUserId: 'sc6_follower_1005',
      uniqueId: 'new_follower_jane',
      nickname: 'Jane Follower',
    });

    // Share event
    connector.simulateShare('whatsapp', 'whatsapp', {
      platformUserId: 'sc6_sharer_1006',
      uniqueId: 'sharing_is_caring',
      nickname: 'Sam Sharer',
    });

    await ingestionService.waitForPending();

    const events = await eventRepo.listBySession(tenantA.id, session.id);
    const followEvt = events.items.find((e) => e.eventType === 'follow');
    expect(followEvt).toBeDefined();

    const shareEvt = events.items.find((e) => e.eventType === 'share');
    expect(shareEvt).toBeDefined();
    expect((shareEvt?.data as any).shareType).toBe('whatsapp');

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 7: Ingestion of roomUser event verifying viewerCount is stored and user_id is strictly NULL in DB', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc7_room_user',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc7_room_user', { sessionId: session.id, tenantId: tenantA.id });

    // Simulate viewer pulses
    connector.simulateRoomUser(1450);
    connector.simulateRoomUser(3200);

    await ingestionService.waitForPending();

    const events = await eventRepo.listBySession(tenantA.id, session.id);
    const roomEvents = events.items.filter((e) => e.eventType === 'roomUser');
    expect(roomEvents.length).toBe(2);

    for (const evt of roomEvents) {
      // CRITICAL PRD NON-GOAL ASSERTION: user_id is strictly null
      expect(evt.userId).toBeNull();
    }

    const latestPulse = roomEvents.find((e) => (e.data as any).viewerCount === 3200);
    expect(latestPulse).toBeDefined();
    expect((latestPulse?.data as any).viewerCount).toBe(3200);

    // Peak viewers tracked in session stats
    const stats = ingestionService.getSessionStats(session.id);
    expect(stats?.peakViewers).toBe(3200);

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 8: Identity quality preservation (Tier 1 never downgraded by Tier 2; Tier 2 upgraded to Tier 1 when platformUserId arrives)', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc8_identity',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc8_identity', { sessionId: session.id, tenantId: tenantA.id });

    // Step A: Ingest Tier 1 user (platformUserId provided)
    connector.simulateChat('I am Tier 1', {
      platformUserId: 'perm_uid_8888',
      uniqueId: 'streamer_alice',
      nickname: 'Alice Original',
      avatarUrl: 'https://example.com/alice1.jpg',
    });

    await ingestionService.waitForPending();

    const tier1User = await prisma.user.findFirst({
      where: { tenantId: tenantA.id, platformUserId: 'perm_uid_8888' },
    });
    expect(tier1User).toBeDefined();
    expect(tier1User?.identityQuality).toBe('platform_id');
    expect(tier1User?.uniqueId).toBe('streamer_alice');

    // Step B: Ingest Tier 2 event for the same handle (platformUserId omitted)
    // PRESERVATION: Tier 1 MUST NOT be downgraded to handle_fallback!
    connector.simulateChat('I have no platform ID now', {
      platformUserId: null,
      uniqueId: 'streamer_alice',
      nickname: 'Alice Updated Handle',
      avatarUrl: 'https://example.com/alice2.jpg',
    });

    await ingestionService.waitForPending();

    const userAfterTier2 = await prisma.user.findFirst({
      where: { id: tier1User!.id },
    });
    expect(userAfterTier2?.identityQuality).toBe('platform_id');
    expect(userAfterTier2?.platformUserId).toBe('perm_uid_8888');
    expect(userAfterTier2?.nickname).toBe('Alice Updated Handle');
    expect(userAfterTier2?.avatarUrl).toBe('https://example.com/alice2.jpg');

    // Step C: Ingest Tier 2 user (only uniqueId known)
    connector.simulateChat('Hello I am Bob', {
      platformUserId: null,
      uniqueId: 'bob_handle_only',
      nickname: 'Bob Handle',
    });

    await ingestionService.waitForPending();

    const bobInitial = await prisma.user.findFirst({
      where: { tenantId: tenantA.id, uniqueId: 'bob_handle_only' },
    });
    expect(bobInitial).toBeDefined();
    expect(bobInitial?.identityQuality).toBe('handle_fallback');
    expect(bobInitial?.platformUserId).toBeNull();

    // Step D: Ingest Tier 1 event for Bob (platformUserId now revealed!)
    // UPGRADE: Bob must be upgraded to platform_id with platformUserId linked
    connector.simulateChat('Now my ID is verified!', {
      platformUserId: 'perm_uid_bob_9999',
      uniqueId: 'bob_handle_only',
      nickname: 'Bob Verified',
    });

    await ingestionService.waitForPending();

    const bobUpgraded = await prisma.user.findFirst({
      where: { id: bobInitial!.id },
    });
    expect(bobUpgraded).toBeDefined();
    expect(bobUpgraded?.identityQuality).toBe('platform_id');
    expect(bobUpgraded?.platformUserId).toBe('perm_uid_bob_9999');
    expect(bobUpgraded?.nickname).toBe('Bob Verified');

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 9: Event deduplication (duplicate eventId ignored)', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc9_dedup',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc9_dedup', { sessionId: session.id, tenantId: tenantA.id });

    const fixedEventId = 'fixed_event_dedup_uuid_0001';

    // Ingest first time
    connector.simulateEvent({
      id: fixedEventId,
      type: 'chat',
      user: FIXTURE_USERS.TIER1_BOB,
      data: { comment: 'First and only message' },
    });

    await ingestionService.waitForPending();

    // Ingest duplicate with exact same ID
    connector.simulateEvent({
      id: fixedEventId,
      type: 'chat',
      user: FIXTURE_USERS.TIER1_BOB,
      data: { comment: 'First and only message' },
    });

    await ingestionService.waitForPending();

    const events = await eventRepo.listBySession(tenantA.id, session.id);
    expect(events.items.length).toBe(1);

    await connector.disconnect();
    sub.unsubscribe();
  });

  it('Scenario 10: Disconnect and Reconnection simulation with backoff', async () => {
    const session = await sessionRepo.create(tenantA.id, {
      creatorUsername: 'streamer_sc10_reconnect',
    });
    const connector = new MockConnector();
    const sub = ingestionService.attachConnector(tenantA.id, session.id, connector);
    await connector.connect('streamer_sc10_reconnect', { sessionId: session.id, tenantId: tenantA.id });
    await ingestionService.waitForPending();

    // Step 1: Simulate network disconnect
    await connector.simulateDisconnect('NETWORK_LOST');
    await ingestionService.waitForPending();

    const reconnectingSession = await sessionRepo.findById(tenantA.id, session.id);
    expect(reconnectingSession?.status).toBe('reconnecting');

    // Step 2: Verify backoff delays calculated
    for (let k = 0; k < 5; k++) {
      const delay = connector.calculateBackoffDelay(k);
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(30000);
    }

    // Step 3: Simulate successful reconnect
    await connector.simulateReconnect(1, 1000);
    await ingestionService.waitForPending();

    const reconnectedSession = await sessionRepo.findById(tenantA.id, session.id);
    expect(reconnectedSession?.status).toBe('connected');

    // Step 4: Emit an event while reconnected
    connector.simulateLike(10);
    await ingestionService.waitForPending();

    // Step 5: Simulate host ending stream
    connector.simulateStreamEnd();
    await ingestionService.waitForPending();

    const endedSession = await sessionRepo.findById(tenantA.id, session.id);
    expect(endedSession?.status).toBe('ended');
    expect(endedSession?.endedAt).not.toBeNull();
    expect(endedSession?.disconnectReason).toBe('LIVE_ENDED_BY_CREATOR');

    const stats = (endedSession?.connectorMetadata as any)?.stats;
    expect(stats).toBeDefined();
    expect(stats?.totalEvents).toBeGreaterThan(0);

    sub.unsubscribe();
  });
});
