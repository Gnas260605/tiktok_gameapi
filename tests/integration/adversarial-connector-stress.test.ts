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

describe('Adversarial Stress Suite: Connector Subsystem & Event Ingestion Pipeline', () => {
  let prisma: PrismaClient;
  let tenantRepo: TenantRepository;
  let sessionRepo: SessionRepository;
  let userRepo: UserRepository;
  let eventRepo: EventRepository;
  let userNormService: UserNormalizationService;
  let ingestionService: EventIngestionService;

  let stressTenant: Tenant;
  let secondTenant: Tenant;

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
      { dedupTtlMs: 60000, dedupCacheSize: 10000 }
    );

    stressTenant = await tenantRepo.create({
      name: 'Adversarial Stress Tenant Alpha',
      status: 'active',
    });
    secondTenant = await tenantRepo.create({
      name: 'Adversarial Stress Tenant Beta',
      status: 'active',
    });
  });

  afterAll(async () => {
    if (stressTenant) {
      await prisma.tenant.delete({ where: { id: stressTenant.id } }).catch(() => {});
    }
    if (secondTenant) {
      await prisma.tenant.delete({ where: { id: secondTenant.id } }).catch(() => {});
    }
    ingestionService.destroy();
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. HIGH-THROUGHPUT BURST INGESTION (500+ EVENTS)
  // =========================================================================
  describe('1. High-Throughput Burst Ingestion', () => {
    it('Stress 1.1: Ingests 600 mixed events in rapid succession without pool exhaustion or unhandled rejections', async () => {
      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_burst_600',
      });
      const connector = new MockConnector();
      const sub = ingestionService.attachConnector(stressTenant.id, session.id, connector);

      const connectRes = await connector.connect('streamer_burst_600', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });
      expect(connectRes.success).toBe(true);

      const TOTAL_EVENTS = 600;
      const startTime = Date.now();

      // Emit 600 events across all 7 event types in rapid succession
      for (let i = 0; i < TOTAL_EVENTS; i++) {
        const mod = i % 7;
        const userIndex = i % 20; // 20 unique users
        const mockUser = {
          platformUserId: `burst_uid_${userIndex}`,
          uniqueId: `burst_user_${userIndex}`,
          nickname: `Burst User ${userIndex}`,
          avatarUrl: `https://example.com/avatar_${userIndex}.jpg`,
        };

        switch (mod) {
          case 0:
            connector.simulateLike(1 + (i % 5), undefined, mockUser);
            break;
          case 1:
            connector.simulateChat(`Rapid chat message #${i}`, mockUser);
            break;
          case 2:
            connector.simulateGift('Rose', 1, 1 + (i % 3), true, mockUser);
            break;
          case 3:
            connector.simulateMember(mockUser);
            break;
          case 4:
            connector.simulateFollow(mockUser);
            break;
          case 5:
            connector.simulateShare('copy_link', 'copy_link', mockUser);
            break;
          case 6:
            connector.simulateRoomUser(500 + i);
            break;
        }
      }

      // Wait for all in-flight asynchronous ingestion tasks to complete
      await ingestionService.waitForPending();
      const durationMs = Date.now() - startTime;
      expect(durationMs).toBeGreaterThan(0);

      // 1. Verify all 600 events were saved in database
      const persistedEvents = await prisma.event.findMany({
        where: { tenantId: stressTenant.id, sessionId: session.id },
      });
      expect(persistedEvents.length).toBe(TOTAL_EVENTS);

      // 2. Verify session aggregate stats
      const sessionStats = ingestionService.getSessionStats(session.id);
      expect(sessionStats).toBeDefined();
      expect(sessionStats?.totalEvents).toBe(TOTAL_EVENTS);
      expect(sessionStats?.peakViewers).toBeGreaterThanOrEqual(500);

      // 3. Verify roomUser events have strictly userId = null
      const roomEvents = persistedEvents.filter((e) => e.eventType === 'roomUser');
      expect(roomEvents.length).toBeGreaterThan(0);
      for (const revt of roomEvents) {
        expect(revt.userId).toBeNull();
      }

      // 4. Verify user upserts: exactly 20 unique users persisted
      const persistedUsers = await prisma.user.findMany({
        where: { tenantId: stressTenant.id, uniqueId: { startsWith: 'burst_user_' } },
      });
      expect(persistedUsers.length).toBe(20);

      await connector.disconnect();
      sub.unsubscribe();
    }, 30000);

    it('Stress 1.2: Concurrency collision stress - 100 simultaneous events for the same new user', async () => {
      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_concurrency_race',
      });
      const connector = new MockConnector();
      const sub = ingestionService.attachConnector(stressTenant.id, session.id, connector);
      await connector.connect('streamer_concurrency_race', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });

      const singleUser = {
        platformUserId: 'race_condition_user_9999',
        uniqueId: 'speedy_gonzales',
        nickname: 'Speedy Gonzales',
      };

      // Emit 100 chats simultaneously for the exact same user
      for (let i = 0; i < 100; i++) {
        connector.simulateChat(`Race comment #${i}`, singleUser, `msg_race_${i}`);
      }

      await ingestionService.waitForPending();

      // Exactly 1 user should exist in DB
      const userMatches = await prisma.user.findMany({
        where: { tenantId: stressTenant.id, platformUserId: 'race_condition_user_9999' },
      });
      expect(userMatches.length).toBe(1);

      // All 100 events should be recorded
      const chatEvents = await prisma.event.findMany({
        where: { tenantId: stressTenant.id, sessionId: session.id, eventType: 'chat' },
      });
      expect(chatEvents.length).toBe(100);

      await connector.disconnect();
      sub.unsubscribe();
    });

    it('Stress 1.3: Database queries executed concurrently during active burst without pool starvation', async () => {
      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_pool_stress',
      });
      const connector = new MockConnector();
      const sub = ingestionService.attachConnector(stressTenant.id, session.id, connector);
      await connector.connect('streamer_pool_stress', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });

      // Launch 200 events
      for (let i = 0; i < 200; i++) {
        connector.simulateLike(2, undefined, {
          platformUserId: `liker_pool_${i % 10}`,
          uniqueId: `liker_handle_${i % 10}`,
        });
      }

      // In parallel, perform continuous reads on tenant/session repositories
      const readPromises: Promise<any>[] = [];
      for (let r = 0; r < 20; r++) {
        readPromises.push(sessionRepo.findById(stressTenant.id, session.id));
        readPromises.push(tenantRepo.findById(stressTenant.id));
      }

      const readResults = await Promise.all(readPromises);
      expect(readResults.length).toBe(40);
      for (const res of readResults) {
        expect(res).not.toBeNull();
      }

      await ingestionService.waitForPending();

      await connector.disconnect();
      sub.unsubscribe();
    });
  });

  // =========================================================================
  // 2. DEDUPLICATION STRESS
  // =========================================================================
  describe('2. Deduplication Stress', () => {
    it('Stress 2.1: Duplicate event IDs correctly suppressed', async () => {
      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_dedup_id_stress',
      });
      const connector = new MockConnector();
      const sub = ingestionService.attachConnector(stressTenant.id, session.id, connector);
      await connector.connect('streamer_dedup_id_stress', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });

      // 50 unique event IDs, each sent 3 times (150 total emissions)
      const UNIQUE_COUNT = 50;
      const DUPLICATE_FACTOR = 3;

      for (let rep = 0; rep < DUPLICATE_FACTOR; rep++) {
        for (let i = 0; i < UNIQUE_COUNT; i++) {
          connector.simulateEvent({
            id: `adversarial_dedup_id_${i}`,
            type: 'chat',
            user: {
              ...FIXTURE_USERS.TIER1_BOB,
              uniqueId: `chatter_${i}`,
            },
            data: { comment: `Message from chatter ${i} (attempt ${rep})` },
          });
        }
      }

      await ingestionService.waitForPending();

      // Only 50 events should be persisted
      const eventsInDb = await prisma.event.findMany({
        where: { tenantId: stressTenant.id, sessionId: session.id },
      });
      expect(eventsInDb.length).toBe(UNIQUE_COUNT);

      await connector.disconnect();
      sub.unsubscribe();
    });

    it('Stress 2.2: Payload fingerprint deduplication (events without eventId)', async () => {
      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_fingerprint_stress',
      });
      const connector = new MockConnector();
      const sub = ingestionService.attachConnector(stressTenant.id, session.id, connector);
      await connector.connect('streamer_fingerprint_stress', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });

      const fixedTime = new Date('2026-11-02T15:00:00.000Z');
      const payloadData = { giftId: '5655', diamondCount: 1, repeatCount: 1 };

      // Ingest identical payload with same timestamp 5 times directly without eventId
      for (let i = 0; i < 5; i++) {
        await ingestionService.ingestEvent({
          tenantId: stressTenant.id,
          sessionId: session.id,
          eventType: 'gift',
          occurredAt: fixedTime,
          user: FIXTURE_USERS.TIER1_ALICE,
          payload: payloadData,
        });
      }

      await ingestionService.waitForPending();

      // Exactly 1 event should be persisted (fingerprint deduplicated the 4 identical duplicates)
      const dbEvents = await prisma.event.findMany({
        where: { tenantId: stressTenant.id, sessionId: session.id },
      });
      expect(dbEvents.length).toBe(1);

      // Now emit identical payload but with different timestamp -> SHOULD NOT be suppressed
      const newTime = new Date('2026-11-02T15:00:01.000Z');
      await ingestionService.ingestEvent({
        tenantId: stressTenant.id,
        sessionId: session.id,
        eventType: 'gift',
        occurredAt: newTime,
        user: FIXTURE_USERS.TIER1_ALICE,
        payload: payloadData,
      });

      await ingestionService.waitForPending();

      const dbEventsAfter = await prisma.event.findMany({
        where: { tenantId: stressTenant.id, sessionId: session.id },
      });
      expect(dbEventsAfter.length).toBe(2);

      // Verify MockConnector omits id when not explicitly provided,
      // allowing payload fingerprinting deduplication to operate.
      const simulatedEvt1 = connector.simulateEvent({
        type: 'gift',
        data: payloadData,
      });
      const simulatedEvt2 = connector.simulateEvent({
        type: 'gift',
        data: payloadData,
      });
      expect(simulatedEvt1.id).toBeUndefined();
      expect(simulatedEvt2.id).toBeUndefined();

      await connector.disconnect();
      sub.unsubscribe();
    });

    it('Stress 2.3: Cross-tenant / cross-session deduplication isolation', async () => {
      const sessionA = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_isolation_a',
      });
      const sessionB = await sessionRepo.create(secondTenant.id, {
        creatorUsername: 'streamer_isolation_b',
      });

      const connectorA = new MockConnector();
      const connectorB = new MockConnector();

      const subA = ingestionService.attachConnector(stressTenant.id, sessionA.id, connectorA);
      const subB = ingestionService.attachConnector(secondTenant.id, sessionB.id, connectorB);

      await connectorA.connect('streamer_isolation_a', {
        sessionId: sessionA.id,
        tenantId: stressTenant.id,
      });
      await connectorB.connect('streamer_isolation_b', {
        sessionId: sessionB.id,
        tenantId: secondTenant.id,
      });

      const sharedEventId = 'globally_shared_event_id_xyz';

      // Both tenants ingest an event with the exact same eventId
      connectorA.simulateEvent({
        id: sharedEventId,
        type: 'chat',
        user: FIXTURE_USERS.TIER1_BOB,
        data: { comment: 'Chat on Tenant Alpha' },
      });

      connectorB.simulateEvent({
        id: sharedEventId,
        type: 'chat',
        user: FIXTURE_USERS.TIER1_BOB,
        data: { comment: 'Chat on Tenant Beta' },
      });

      await ingestionService.waitForPending();

      // Tenant A should have 1 event
      const eventsA = await prisma.event.findMany({
        where: { tenantId: stressTenant.id, sessionId: sessionA.id },
      });
      expect(eventsA.length).toBe(1);

      // Tenant B MUST ALSO have 1 event (dedup must be isolated per tenant:session!)
      const eventsB = await prisma.event.findMany({
        where: { tenantId: secondTenant.id, sessionId: sessionB.id },
      });
      expect(eventsB.length).toBe(1);

      await connectorA.disconnect();
      await connectorB.disconnect();
      subA.unsubscribe();
      subB.unsubscribe();
    });

    it('Stress 2.4: Dedup cache eviction when size limit reached', async () => {
      // Create a small dedup cache service to stress LRU/FIFO eviction
      const smallDedupService = new EventIngestionService(
        sessionRepo,
        userRepo,
        eventRepo,
        userNormService,
        undefined,
        { dedupCacheSize: 10, dedupTtlMs: 60000 }
      );

      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_cache_eviction',
      });
      const connector = new MockConnector();
      const sub = smallDedupService.attachConnector(stressTenant.id, session.id, connector);
      await connector.connect('streamer_cache_eviction', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });

      // Send 30 distinct events to exceed cache capacity of 10
      for (let i = 0; i < 30; i++) {
        connector.simulateEvent({
          id: `evict_event_${i}`,
          type: 'like',
          user: FIXTURE_USERS.TIER2_CHARLIE,
          data: { likeCount: 1 },
        });
      }

      await smallDedupService.waitForPending();

      const events = await prisma.event.findMany({
        where: { tenantId: stressTenant.id, sessionId: session.id },
      });
      expect(events.length).toBe(30);

      await connector.disconnect();
      sub.unsubscribe();
      smallDedupService.destroy();
    });
  });

  // =========================================================================
  // 3. RAPID LIFECYCLE TRANSITIONS & FSM CONSISTENCY
  // =========================================================================
  describe('3. Rapid Lifecycle Transitions & FSM Consistency', () => {
    it('Stress 3.1: Rapid simulateDisconnect -> simulateReconnect loop maintains consistent state', async () => {
      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_reconnect_loop',
      });
      const connector = new MockConnector();
      const sub = ingestionService.attachConnector(stressTenant.id, session.id, connector);

      await connector.connect('streamer_reconnect_loop', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });
      await ingestionService.waitForPending();

      const CYCLES = 10;
      for (let c = 0; c < CYCLES; c++) {
        await connector.simulateDisconnect('NETWORK_BLIP');
        expect(connector.getStatus()).toBe('reconnecting');
        await ingestionService.waitForPending();

        const delay = connector.calculateBackoffDelay(c % 5);
        expect(delay).toBeGreaterThanOrEqual(0);

        const recRes = await connector.simulateReconnect(c + 1, delay);
        expect(recRes.success).toBe(true);
        expect(connector.getStatus()).toBe('connected');
        expect(connector.isConnected()).toBe(true);
        await ingestionService.waitForPending();
      }

      await ingestionService.waitForPending();

      const finalDbSession = await sessionRepo.findById(stressTenant.id, session.id);
      expect(finalDbSession?.status).toBe('connected');

      await connector.disconnect('CLEAN_SHUTDOWN');
      await ingestionService.waitForPending();

      const closedSession = await sessionRepo.findById(stressTenant.id, session.id);
      expect(closedSession?.status).toBe('disconnected');

      sub.unsubscribe();
    });

    it('Stress 3.2: Behavior when connect() is called on an already disconnected instance', async () => {
      const connector = new MockConnector();
      await connector.connect('streamer_terminal_test');
      expect(connector.getStatus()).toBe('connected');

      await connector.disconnect('SHUTDOWN');
      expect(connector.getStatus()).toBe('disconnected');

      // Attempting to re-connect a disconnected instance
      // In BaseConnector, 'disconnected' is terminal (allowed transitions: [])
      const reconnectedResult = await connector.connect('streamer_terminal_test');
      expect(reconnectedResult).toBeDefined();

      // Verify empirical behavior:
      // Status in connector remains 'disconnected' because transitionTo rejected the illegal transition!
      expect(connector.getStatus()).toBe('disconnected');
      expect(connector.isConnected()).toBe(false);

      // Note: reconnectedResult returns { success: true, status: 'connected' } due to MockConnector mock return,
      // but internal FSM correctly prevented status transition and stayed 'disconnected'!
    });

    it('Stress 3.3: Illegal state transitions are rejected and do not corrupt FSM', () => {
      const connector = new MockConnector();
      expect(connector.getStatus()).toBe('queued');

      // Attempt illegal transition queued -> reconnecting
      // @ts-expect-error accessing protected method for testing
      const illegal1 = connector.transitionTo('reconnecting');
      expect(illegal1).toBe(false);
      expect(connector.getStatus()).toBe('queued');

      // Attempt illegal transition queued -> ended
      // @ts-expect-error accessing protected method for testing
      const illegal2 = connector.transitionTo('ended');
      expect(illegal2).toBe(false);
      expect(connector.getStatus()).toBe('queued');
    });

    it('Stress 3.4: Disconnect called immediately during connecting handshake', async () => {
      const connector = new MockConnector();
      // connect starts connecting asynchronously (<10ms)
      const connectPromise = connector.connect('streamer_fast_cancel');
      // Immediately disconnect
      await connector.disconnect('CANCEL_BEFORE_CONNECT');
      const result = await connectPromise;

      expect(connector.getStatus()).toBe('disconnected');
      expect(connector.isConnected()).toBe(false);
      expect(result.status).toBe('disconnected');
    });

    it('Stress 3.5: Stream termination by creator transitions directly to ended with final stats flushed', async () => {
      const session = await sessionRepo.create(stressTenant.id, {
        creatorUsername: 'streamer_stream_end',
      });
      const connector = new MockConnector();
      const sub = ingestionService.attachConnector(stressTenant.id, session.id, connector);
      await connector.connect('streamer_stream_end', {
        sessionId: session.id,
        tenantId: stressTenant.id,
      });

      connector.simulateChat('Final chat before end');
      connector.simulateLike(10);
      await ingestionService.waitForPending();

      connector.simulateStreamEnd();
      await ingestionService.waitForPending();

      const endedSession = await sessionRepo.findById(stressTenant.id, session.id);
      expect(endedSession?.status).toBe('ended');
      expect(endedSession?.disconnectReason).toBe('LIVE_ENDED_BY_CREATOR');
      expect(endedSession?.endedAt).not.toBeNull();

      const metadata = endedSession?.connectorMetadata as any;
      expect(metadata?.stats?.totalEvents).toBe(2);

      sub.unsubscribe();
    });
  });
});
