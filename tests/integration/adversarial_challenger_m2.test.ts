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
import { MockConnector, BaseConnector } from '../../src/adapters/tiktok';

class TestableBaseConnector extends BaseConnector {
  public async connect(_username: string): Promise<any> {
    return { success: true };
  }
  public async disconnect(): Promise<void> {}
  public publicTransition(newStatus: any, reason?: string) {
    return this.transitionTo(newStatus, reason);
  }
  public getAttempts(): number {
    return this.reconnectAttempts;
  }
  public setAttempts(n: number) {
    this.reconnectAttempts = n;
  }
}

describe('Adversarial Challenger M2: Edge Cases & Boundary Conditions Suite', () => {
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

    tenantA = await tenantRepo.create({ name: 'Challenger M2 Tenant Alpha', status: 'active' });
    tenantB = await tenantRepo.create({ name: 'Challenger M2 Tenant Beta', status: 'active' });
  });

  afterAll(async () => {
    if (tenantA) await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => {});
    if (tenantB) await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => {});
    ingestionService.destroy();
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. IDENTITY HIERARCHY EDGE CASES
  // =========================================================================
  describe('1. Identity Hierarchy & Concurrency Edge Cases', () => {
    it('1.1: 25 simultaneous concurrent upserts of the same Tier 1 user (platformUserId)', async () => {
      const platformUserId = `adv_concurrent_pid_${Date.now()}`;
      const uniqueId = `adv_user_${Date.now()}`;

      // Dispatch 25 concurrent upsert operations
      const promises = Array.from({ length: 25 }, (_, i) =>
        userRepo.upsertUser(tenantA.id, {
          platform: 'tiktok',
          platformUserId,
          uniqueId,
          nickname: `Concurrent User Thread ${i}`,
          avatarUrl: `https://p16-sign.tiktokcdn.com/avatar_${i}.jpg`,
          verified: false,
        })
      );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(rejected.length).toBe(0);
      expect(fulfilled.length).toBe(25);

      // Verify DB contains exactly 1 user with this platformUserId
      const dbUsers = await prisma.user.findMany({
        where: {
          tenantId: tenantA.id,
          platformUserId,
        },
      });
      expect(dbUsers.length).toBe(1);
      expect(dbUsers[0].platformUserId).toBe(platformUserId);
      expect(dbUsers[0].uniqueId).toBe(uniqueId);
      expect(dbUsers[0].identityQuality).toBe('platform_id');
    });

    it('1.2: 25 simultaneous concurrent upserts of the same Tier 2 user (uniqueId only)', async () => {
      const uniqueId = `adv_handle_only_${Date.now()}`;

      const promises = Array.from({ length: 25 }, (_, i) =>
        userRepo.upsertUser(tenantA.id, {
          platform: 'tiktok',
          uniqueId,
          nickname: `Handle Thread ${i}`,
        })
      );

      const results = await Promise.allSettled(promises);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.length).toBe(0);

      const dbUsers = await prisma.user.findMany({
        where: {
          tenantId: tenantA.id,
          uniqueId,
        },
      });
      expect(dbUsers.length).toBe(1);
      expect(dbUsers[0].platformUserId).toBeNull();
      expect(dbUsers[0].uniqueId).toBe(uniqueId);
      expect(dbUsers[0].identityQuality).toBe('handle_fallback');
    });

    it('1.3: Concurrent race condition between Tier 2 (handle_fallback) and Tier 1 (platform_id) upgrade', async () => {
      const sharedUniqueId = `upgrade_race_${Date.now()}`;
      const stablePid = `pid_race_${Date.now()}`;

      // Mix 10 Tier 2 upserts and 10 Tier 1 upserts simultaneously
      const promises = [
        ...Array.from({ length: 10 }, (_, i) =>
          userRepo.upsertUser(tenantA.id, {
            platform: 'tiktok',
            uniqueId: sharedUniqueId,
            nickname: `Tier 2 Attempt ${i}`,
          })
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          userRepo.upsertUser(tenantA.id, {
            platform: 'tiktok',
            platformUserId: stablePid,
            uniqueId: sharedUniqueId,
            nickname: `Tier 1 Upgrade Attempt ${i}`,
            verified: true,
          })
        ),
      ];

      // Shuffle promises to maximize interleaving
      const shuffled = promises.sort(() => Math.random() - 0.5);
      const results = await Promise.allSettled(shuffled);
      const rejected = results.filter((r) => r.status === 'rejected');
      if (rejected.length > 0) {
        console.error('Test 1.3 rejected reasons:', rejected.map((r: any) => r.reason?.message || r.reason));
      }
      expect(rejected.length).toBe(0);

      // Verify that the user was upgraded to Tier 1 and no duplicate user exists
      const dbUsers = await prisma.user.findMany({
        where: {
          tenantId: tenantA.id,
          uniqueId: sharedUniqueId,
        },
      });

      expect(dbUsers.length).toBe(1);
      expect(dbUsers[0].platformUserId).toBe(stablePid);
      expect(dbUsers[0].identityQuality).toBe('platform_id');
      expect(dbUsers[0].verified).toBe(true);
    });

    it('1.4: High concurrency burst ingestion (50 events) through EventIngestionService', async () => {
      const session = await sessionRepo.create(tenantA.id, {
        creatorUsername: 'burst_streamer',
      });
      const sharedUserId = `burst_pid_${Date.now()}`;
      const sharedHandle = `burst_handle_${Date.now()}`;

      const events = Array.from({ length: 50 }, (_, i) => ({
        id: `burst_event_${Date.now()}_${i}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'chat' as const,
        eventTimestamp: new Date(),
        user: {
          platformUserId: sharedUserId,
          uniqueId: sharedHandle,
          nickname: `Burst User ${i}`,
        },
        payload: { comment: `Burst message ${i}`, text: `Burst message ${i}` },
      }));

      // Fire all 50 events concurrently through ingestion
      await Promise.all(events.map((e) => ingestionService.ingestEvent(e)));
      await ingestionService.waitForPending();

      // Exactly 1 user should exist in PostgreSQL
      const users = await prisma.user.findMany({
        where: { tenantId: tenantA.id, platformUserId: sharedUserId },
      });
      expect(users.length).toBe(1);

      // All 50 events must be persisted
      const dbEvents = await prisma.event.findMany({
        where: { tenantId: tenantA.id, sessionId: session.id },
      });
      expect(dbEvents.length).toBe(50);
      expect(dbEvents.every((ev) => ev.userId === users[0].id)).toBe(true);
    });

    it('1.5: High concurrency burst ingestion (20 events) for Tier 2 handle-only user', async () => {
      const session = await sessionRepo.create(tenantA.id, {
        creatorUsername: 'burst_streamer_tier2',
      });
      const sharedHandle = `burst_t2_handle_${Date.now()}`;

      const events = Array.from({ length: 20 }, (_, i) => ({
        id: `burst_t2_event_${Date.now()}_${i}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'chat' as const,
        eventTimestamp: new Date(),
        user: {
          platformUserId: null,
          uniqueId: sharedHandle,
          nickname: `Burst T2 User ${i}`,
        },
        payload: { comment: `Burst T2 message ${i}` },
      }));

      await Promise.all(events.map((e) => ingestionService.ingestEvent(e)));
      await ingestionService.waitForPending();

      const users = await prisma.user.findMany({
        where: { tenantId: tenantA.id, uniqueId: sharedHandle },
      });
      console.log(`Test 1.5: Users created with uniqueId ${sharedHandle}: ${users.length}`);
      expect(users.length).toBe(1);
    });
  });

  // =========================================================================
  // 2. UPSTREAM EVENTS WITH EXTREME CHARACTERS
  // =========================================================================
  describe('2. Upstream Events with Extreme Characters & Injections', () => {
    it('2.1: Zalgo text in nickname and comment', async () => {
      const session = await sessionRepo.create(tenantA.id, { creatorUsername: 'zalgo_streamer' });
      const zalgoNick = 'Ź̸̠a̴͖̎l̸͍̐g̸͚̾o̴̢̎ ̴̱̐ṱ̴̄e̸̬͗x̴̼̌t̵̘̀';
      const zalgoComment = 'C̴̢͑ĥ̴̠a̴̫̾t̴͇͝ ̸̤̓w̸̩͋i̶̧̚t̸̯̋h̶̤̅ ̵͖͐z̷̙̐ä̸͇́l̴̙͋g̵̐͜o̶̦͊';

      const event = await ingestionService.ingestEvent({
        id: `zalgo_ev_${Date.now()}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'chat',
        user: {
          platformUserId: `zalgo_user_${Date.now()}`,
          uniqueId: 'zalgo_fan',
          nickname: zalgoNick,
        },
        payload: { comment: zalgoComment, text: zalgoComment },
      });

      expect(event).toBeDefined();
      expect(event.userId).toBeDefined();

      const savedUser = await userRepo.findById(tenantA.id, event.userId!);
      expect(savedUser?.nickname).toBe(zalgoNick);

      const savedEvent = await eventRepo.findById(tenantA.id, event.id);
      expect((savedEvent?.data as any).comment).toBe(zalgoComment);
    });

    it('2.2: Raw HTML/JS tags (XSS payloads) in nickname, handle, and comment', async () => {
      const session = await sessionRepo.create(tenantA.id, { creatorUsername: 'xss_streamer' });
      const xssNick = '<script>alert("pwned")</script>';
      const xssComment = '"><svg/onload=alert(document.cookie)>';
      const xssHandle = 'user_<img_src=x_onerror=alert(1)>';

      const event = await ingestionService.ingestEvent({
        id: `xss_ev_${Date.now()}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'chat',
        user: {
          platformUserId: `xss_user_${Date.now()}`,
          uniqueId: xssHandle,
          nickname: xssNick,
        },
        payload: { comment: xssComment },
      });

      expect(event).toBeDefined();
      const savedUser = await userRepo.findById(tenantA.id, event.userId!);
      expect(savedUser?.nickname).toBe(xssNick);
      expect(savedUser?.uniqueId).toBe(xssHandle.toLowerCase());

      const savedEvent = await eventRepo.findById(tenantA.id, event.id);
      expect((savedEvent?.data as any).comment).toBe(xssComment);
    });

    it('2.3: Unicode emojis, surrogate pairs, and multi-byte multilingual text', async () => {
      const session = await sessionRepo.create(tenantA.id, { creatorUsername: 'emoji_streamer' });
      const emojiNick = '🔥🚀🎉👑🦁💃🕺🎮👾🦄';
      const multiLangComment = 'Chào bạn 🌟 測試 🚀 日本語 🎌 العربية 🌙 Русский 🇷🇺';

      const event = await ingestionService.ingestEvent({
        id: `emoji_ev_${Date.now()}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'chat',
        user: {
          platformUserId: `emoji_user_${Date.now()}`,
          uniqueId: 'emoji_king',
          nickname: emojiNick,
        },
        payload: { comment: multiLangComment },
      });

      const savedUser = await userRepo.findById(tenantA.id, event.userId!);
      expect(savedUser?.nickname).toBe(emojiNick);

      const savedEvent = await eventRepo.findById(tenantA.id, event.id);
      expect((savedEvent?.data as any).comment).toBe(multiLangComment);
    });

    it('2.4: Extreme string length (10,000 characters) in event payload', async () => {
      const session = await sessionRepo.create(tenantA.id, { creatorUsername: 'long_streamer' });
      const tenKString = 'A'.repeat(10000);

      const event = await ingestionService.ingestEvent({
        id: `long_ev_${Date.now()}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'chat',
        user: {
          platformUserId: `long_user_${Date.now()}`,
          uniqueId: 'regular_handle',
          nickname: 'Regular Nick',
        },
        payload: { comment: tenKString, largePayload: tenKString },
      });

      expect(event).toBeDefined();
      const savedEvent = await eventRepo.findById(tenantA.id, event.id);
      expect((savedEvent?.data as any).comment.length).toBe(10000);
    });

    it('2.5: Extreme string length (10,000 characters) in user nickname - pipeline resilience', async () => {
      const session = await sessionRepo.create(tenantA.id, { creatorUsername: 'long_nick_streamer' });
      const tenKString = 'X'.repeat(10000);

      // Verify that UserNormalizationService sanitizes/processes the string without crashing
      const normalized = userNormService.normalizeUser({
        platformUserId: `tenk_pid_${Date.now()}`,
        uniqueId: 'tenk_user',
        nickname: tenKString,
      });
      expect(normalized).not.toBeNull();

      // When ingested through EventIngestionService, even if user upsert fails due to varchar(255) limit,
      // the ingestion service MUST NOT crash and MUST still persist the event
      const event = await ingestionService.ingestEvent({
        id: `tenk_ev_${Date.now()}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'chat',
        user: {
          platformUserId: `tenk_user_${Date.now()}`,
          uniqueId: 'tenk_handle',
          nickname: tenKString,
        },
        payload: { comment: 'Testing resilience against oversized nickname' },
      });

      // Pipeline remained stable and persisted the event
      expect(event).toBeDefined();
      expect(event.eventType).toBe('chat');
    });

    it('2.6: Missing nickname (empty string, whitespace, undefined) fallback handling', () => {
      const fallback1 = userNormService.sanitizeNickname('', 'user_fallback');
      expect(fallback1).toBe('user_fallback');

      const fallback2 = userNormService.sanitizeNickname('    ', 'user_fallback');
      expect(fallback2).toBe('user_fallback');

      const fallback3 = userNormService.sanitizeNickname(null, null);
      expect(fallback3).toBe('TikTok Viewer');

      const fallback4 = userNormService.sanitizeNickname(undefined, null);
      expect(fallback4).toBe('TikTok Viewer');

      const userNormalized = userNormService.normalizeUser({
        uniqueId: 'lonely_handle',
        nickname: '   ',
      });
      expect(userNormalized?.nickname).toBe('lonely_handle');
    });

    it('2.7: Malformed avatar URLs security validation (rejecting javascript:, data:, file:)', () => {
      // Malformed / dangerous URLs must be rejected (return null)
      expect(userNormService.sanitizeAvatarUrl('javascript:evil()')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl('javascript:alert(1)')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl('file:///etc/passwd')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl('ftp://ftp.example.com/avatar.png')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl('//cdn.tiktok.com/image.png')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl('not-a-url')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl('')).toBeNull();
      expect(userNormService.sanitizeAvatarUrl(null)).toBeNull();
      expect(userNormService.sanitizeAvatarUrl(undefined)).toBeNull();

      // Valid HTTP/HTTPS URLs must be preserved
      expect(userNormService.sanitizeAvatarUrl('https://p16-sign.tiktokcdn.com/avatar.jpg')).toBe(
        'https://p16-sign.tiktokcdn.com/avatar.jpg'
      );
      expect(userNormService.sanitizeAvatarUrl('http://insecure.tiktokcdn.com/avatar.jpg')).toBe(
        'http://insecure.tiktokcdn.com/avatar.jpg'
      );
    });
  });

  // =========================================================================
  // 3. NEGATIVE TEST: roomUser NEVER CREATES USER OR SETS userId != null
  // =========================================================================
  describe('3. Negative Test: roomUser Absolute Isolation Invariant', () => {
    it('3.1: UserNormalizationService strictly returns null for roomUser even with rich user object', () => {
      const maliciousPayload = {
        platformUserId: '999999999',
        uniqueId: 'ghost_viewer',
        nickname: 'Ghost In The Machine',
        avatarUrl: 'https://p16-sign.tiktokcdn.com/avatar.jpg',
      };

      const result1 = userNormService.normalizeUser(maliciousPayload, 'roomUser');
      expect(result1).toBeNull();

      const result2 = userNormService.normalizeUserFromEvent({
        eventType: 'roomUser',
        user: maliciousPayload,
      });
      expect(result2).toBeNull();

      const result3 = userNormService.normalizeUserFromEvent(
        { user: maliciousPayload },
        'roomUser'
      );
      expect(result3).toBeNull();
    });

    it('3.2: MockConnector.simulateRoomUser strictly emits CanonicalEvent with user: null', () => {
      const connector = new MockConnector();
      const emitted: any[] = [];
      connector.on('roomUser', (e) => emitted.push(e));

      const event = connector.simulateRoomUser(1234);

      expect(event.eventType).toBe('roomUser');
      expect(event.user).toBeNull();
      expect(emitted.length).toBe(1);
      expect(emitted[0].user).toBeNull();
      expect(emitted[0].payload.viewerCount).toBe(1234);
    });

    it('3.3: Ingestion pipeline guarantees NO user created and userId IS NULL for roomUser', async () => {
      const session = await sessionRepo.create(tenantA.id, {
        creatorUsername: 'roomuser_isolation_streamer',
      });

      const usersCountBefore = await prisma.user.count({ where: { tenantId: tenantA.id } });

      // Adversarial attempt: inject roomUser with an embedded user identity
      const ingested = await ingestionService.ingestEvent({
        id: `roomuser_adv_${Date.now()}`,
        tenantId: tenantA.id,
        sessionId: session.id,
        eventType: 'roomUser',
        user: {
          platformUserId: 'roomuser_exploit_id',
          uniqueId: 'roomuser_exploit_handle',
          nickname: 'Should Never Exist',
        },
        payload: { viewerCount: 888 },
      });

      expect(ingested).toBeDefined();
      expect(ingested.userId).toBeNull();

      // Verify DB record has userId == null
      const dbEvent = await eventRepo.findById(tenantA.id, ingested.id);
      expect(dbEvent).not.toBeNull();
      expect(dbEvent?.userId).toBeNull();
      expect((dbEvent?.data as any).viewerCount).toBe(888);

      // Verify that NO new user was inserted into users table
      const usersCountAfter = await prisma.user.count({ where: { tenantId: tenantA.id } });
      expect(usersCountAfter).toBe(usersCountBefore);

      const ghostUser = await prisma.user.findFirst({
        where: {
          tenantId: tenantA.id,
          uniqueId: 'roomuser_exploit_handle',
        },
      });
      expect(ghostUser).toBeNull();
    });
  });

  // =========================================================================
  // 4. CONNECTOR EDGE CASES: USERNAMES & RECONNECTION BACKOFF
  // =========================================================================
  describe('4. Connector Edge Cases: Usernames & Backoff Calculation', () => {
    it('4.1: Creator username normalization handling (@@streamer, whitespace, specials)', () => {
      const connector = new MockConnector();

      // Strips leading @@ and trims and lowercases
      expect(connector.normalizeCreatorUsername('@@streamer')).toBe('streamer');
      expect(connector.normalizeCreatorUsername('  @@@AwesomeStreamer_99  ')).toBe('awesomestreamer_99');

      // Whitespace string reduces to empty string
      expect(connector.normalizeCreatorUsername('   ')).toBe('');

      // Special characters preserved after trim & lowercase
      expect(connector.normalizeCreatorUsername('streamer/special')).toBe('streamer/special');
      expect(connector.normalizeCreatorUsername('STREAMER-OFFICIAL')).toBe('streamer-official');
    });

    it('4.2: Full jitter backoff mathematical verification across attempts 0 to 6', () => {
      const connector = new MockConnector();

      // Theoretical maximums: min(30000, 1000 * 2^k)
      // k=0: 1000
      // k=1: 2000
      // k=2: 4000
      // k=3: 8000
      // k=4: 16000
      // k=5: 30000 (capped from 32000)
      // k=6: 30000 (capped)
      const expectedCaps = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

      for (let attempt = 0; attempt <= 6; attempt++) {
        const expectedCap = expectedCaps[attempt];
        const samples: number[] = [];

        // Sample 300 iterations per attempt
        for (let i = 0; i < 300; i++) {
          const delay = connector.calculateBackoffDelay(attempt);

          // Invariant 1: Must never be lower than lower floor (50ms)
          expect(delay).toBeGreaterThanOrEqual(50);

          // Invariant 2: Must never exceed mathematical upper bound
          expect(delay).toBeLessThanOrEqual(expectedCap);

          samples.push(delay);
        }

        // Invariant 3: Verify randomness / jitter (not all identical values)
        const uniqueValues = new Set(samples);
        expect(uniqueValues.size).toBeGreaterThan(50);
      }
    });

    it('4.3: Maximum retry limit (5 retries) and state machine failure transition', () => {
      const testConnector = new TestableBaseConnector();
      expect(testConnector.getStatus()).toBe('queued');

      // Transition to connecting -> connected -> reconnecting
      testConnector.publicTransition('connecting');
      testConnector.publicTransition('connected');
      testConnector.publicTransition('reconnecting', 'NETWORK_DROP');
      expect(testConnector.getStatus()).toBe('reconnecting');

      // Emulate retry attempts up to maxRetries (5)
      testConnector.setAttempts(5);
      expect(testConnector.getAttempts()).toBe(5);

      // After 5 attempts, it must transition to failed terminal state
      testConnector.publicTransition('failed', 'MAX_RETRIES_EXCEEDED');
      expect(testConnector.getStatus()).toBe('failed');

      // Once in terminal 'failed' state, no further transitions to reconnecting or connected are allowed
      const illegalTransition = testConnector.publicTransition('connected');
      expect(illegalTransition).toBe(false);
      expect(testConnector.getStatus()).toBe('failed');
    });

    it('4.4: Connector and repository behavior with invalid creator usernames (@@streamer, whitespace, special chars)', async () => {
      // 1. @@streamer should normalize to streamer
      const session1 = await sessionRepo.create(tenantA.id, {
        creatorUsername: '@@streamer',
      });
      expect(session1.creatorUsername).toBe('streamer');

      // 2. Whitespace-only username "   " rejected
      await expect(
        sessionRepo.create(tenantA.id, {
          creatorUsername: '   ',
        })
      ).rejects.toThrow();

      // 3. Special characters "streamer/special"
      const sessionSpecial = await sessionRepo.create(tenantA.id, {
        creatorUsername: 'streamer/special',
      });
      expect(sessionSpecial.creatorUsername).toBe('streamer/special');

      // 4. MockConnector connection with empty / whitespace username
      const connector = new MockConnector();
      const res = await connector.connect('   ');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
      await connector.disconnect();
    });
  });
});

