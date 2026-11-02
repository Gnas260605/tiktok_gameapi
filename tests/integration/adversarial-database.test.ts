import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Event } from '@prisma/client';
import {
  TenantRepository,
  SessionRepository,
  UserRepository,
  EventRepository,
} from '../../src/repositories';

describe('Adversarial Database Verification Suite (Milestone 1)', () => {
  let prisma: PrismaClient;
  let tenantRepo: TenantRepository;
  let sessionRepo: SessionRepository;
  let userRepo: UserRepository;
  let eventRepo: EventRepository;

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    tenantRepo = new TenantRepository(prisma);
    sessionRepo = new SessionRepository(prisma);
    userRepo = new UserRepository(prisma);
    eventRepo = new EventRepository(prisma);

    // Create 2 isolated test tenants for adversarial stress testing
    const tenantA = await tenantRepo.create({
      name: 'Adversarial Test Tenant Alpha',
      status: 'active',
    });
    const tenantB = await tenantRepo.create({
      name: 'Adversarial Test Tenant Beta',
      status: 'active',
    });

    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    if (tenantAId) await prisma.tenant.delete({ where: { id: tenantAId } }).catch(() => {});
    if (tenantBId) await prisma.tenant.delete({ where: { id: tenantBId } }).catch(() => {});
    await prisma.$disconnect();
  });

  // =========================================================================
  // OBJECTIVE 1: Partial unique index enforcement on live_sessions
  // =========================================================================
  describe('Objective 1: Partial Unique Index on live_sessions', () => {
    const creator = 'adversarial_streamer_01';

    it('strictly blocks creating 2 active sessions for the same creator in the same tenant', async () => {
      // 1. Create first session in 'queued' status (active)
      const session1 = await sessionRepo.create(tenantAId, {
        creatorUsername: creator,
      });
      expect(session1.id).toBeDefined();
      expect(session1.status).toBe('queued');

      // 2. Attempt to create second session for same creator in Tenant A -> MUST FAIL
      let errorThrown: any = null;
      try {
        await sessionRepo.create(tenantAId, {
          creatorUsername: creator,
        });
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).not.toBeNull();
      // Prisma P2002 indicates unique constraint violation on PostgreSQL
      expect((errorThrown as any).code).toBe('P2002');

      // Direct Prisma raw insert attempting active status should also fail
      await expect(
        prisma.liveSession.create({
          data: {
            tenantId: tenantAId,
            platform: 'tiktok',
            creatorUsername: creator,
            status: 'connecting', // also in active list
          },
        })
      ).rejects.toThrow();
    });

    it('enforces case-insensitive creator username collision on active sessions', async () => {
      // Attempting with uppercase and '@' prefix for the creator who already has active session
      await expect(
        sessionRepo.create(tenantAId, {
          creatorUsername: `@${creator.toUpperCase()}`,
        })
      ).rejects.toThrow();
    });

    it('allows a new active session once the previous active session transitions to ended', async () => {
      // 1. Find the currently active session
      const activeSession = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', creator);
      expect(activeSession).not.toBeNull();

      // 2. Transition it to 'ended'
      const endedSession = await sessionRepo.updateStatus(
        tenantAId,
        activeSession!.id,
        'ended',
        { endedAt: new Date(), disconnectReason: 'stream_concluded' }
      );
      expect(endedSession?.status).toBe('ended');

      // 3. Verify no active session is found now
      const activeAfterEnd = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', creator);
      expect(activeAfterEnd).toBeNull();

      // 4. Now creating a new active session for the same creator MUST SUCCEED
      const session2 = await sessionRepo.create(tenantAId, {
        creatorUsername: creator,
      });
      expect(session2.id).toBeDefined();
      expect(session2.id).not.toBe(activeSession!.id);
      expect(session2.status).toBe('queued');

      // Clean up by ending session2 as well
      await sessionRepo.updateStatus(tenantAId, session2.id, 'ended');
    });

    it('allows multiple non-active sessions (ended, failed, disconnected) for the same creator', async () => {
      // Create session 3, mark as failed
      const session3 = await sessionRepo.create(tenantAId, { creatorUsername: creator });
      await sessionRepo.updateStatus(tenantAId, session3.id, 'failed');

      // Create session 4, mark as disconnected
      const session4 = await sessionRepo.create(tenantAId, { creatorUsername: creator });
      await sessionRepo.updateStatus(tenantAId, session4.id, 'disconnected');

      // Create session 5, mark as ended
      const session5 = await sessionRepo.create(tenantAId, { creatorUsername: creator });
      await sessionRepo.updateStatus(tenantAId, session5.id, 'ended');

      // Now create another active session
      const sessionActive = await sessionRepo.create(tenantAId, { creatorUsername: creator });
      expect(sessionActive.status).toBe('queued');

      // Total sessions for this creator in Tenant A: 1 (from test 1) + 1 (session 2) + session3 + session4 + session5 + sessionActive = 6
      const allSessions = await sessionRepo.list(tenantAId, { creatorUsername: creator });
      expect(allSessions.items.length).toBeGreaterThanOrEqual(5);

      // Clean up
      await sessionRepo.updateStatus(tenantAId, sessionActive.id, 'ended');
    });

    it('strictly isolates active session uniqueness across tenants', async () => {
      const crossTenantCreator = 'cross_tenant_creator_01';

      // Create active session in Tenant A
      const sessionA = await sessionRepo.create(tenantAId, { creatorUsername: crossTenantCreator });
      expect(sessionA.status).toBe('queued');

      // Create active session for SAME creator in Tenant B -> MUST SUCCEED
      const sessionB = await sessionRepo.create(tenantBId, { creatorUsername: crossTenantCreator });
      expect(sessionB.status).toBe('queued');
      expect(sessionB.id).not.toBe(sessionA.id);

      // But creating a 2nd active session in Tenant B fails
      await expect(
        sessionRepo.create(tenantBId, { creatorUsername: crossTenantCreator })
      ).rejects.toThrow();

      // Clean up
      await sessionRepo.updateStatus(tenantAId, sessionA.id, 'ended');
      await sessionRepo.updateStatus(tenantBId, sessionB.id, 'ended');
    });

    it('blocks updating an ended session back to active when another active session exists', async () => {
      const collisionCreator = 'reactivate_collision_streamer';

      // 1. Create first session and end it
      const sessionOld = await sessionRepo.create(tenantAId, { creatorUsername: collisionCreator });
      await sessionRepo.updateStatus(tenantAId, sessionOld.id, 'ended');

      // 2. Create second session which is now active
      const sessionCurrent = await sessionRepo.create(tenantAId, { creatorUsername: collisionCreator });
      expect(sessionCurrent.status).toBe('queued');

      // 3. Attempting to update sessionOld back to 'connected' (active) MUST trigger uq_active_session_creator
      await expect(
        sessionRepo.updateStatus(tenantAId, sessionOld.id, 'connected')
      ).rejects.toThrow();

      // Clean up
      await sessionRepo.updateStatus(tenantAId, sessionCurrent.id, 'ended');
    });
  });

  // =========================================================================
  // OBJECTIVE 2: User identity quality hierarchy & profile merging
  // =========================================================================
  describe('Objective 2: User Identity Quality Hierarchy & Profile Merging', () => {
    it('executes hierarchy: platform_user_id -> unique_id only -> event snapshot', async () => {
      // Step 1: Upsert with platform_user_id (Tier 1)
      const userStep1 = await userRepo.upsertUser(tenantAId, {
        platformUserId: 'tiktok_uid_hierarchy_01',
        uniqueId: 'streamer_hero',
        nickname: 'Hero Original',
        avatarUrl: 'https://example.com/avatar1.jpg',
        verified: false,
      });

      expect(userStep1.id).toBeDefined();
      expect(userStep1.identityQuality).toBe('platform_id');
      expect(userStep1.platformUserId).toBe('tiktok_uid_hierarchy_01');
      expect(userStep1.uniqueId).toBe('streamer_hero');
      expect(userStep1.nickname).toBe('Hero Original');

      // Step 2: Upsert with only unique_id (no platform_user_id provided)
      // Must resolve to existing user, merge updated profile data, and RETAIN 'platform_id' quality
      const userStep2 = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'streamer_hero', // same handle
        nickname: 'Hero Level 2 Updated',
        avatarUrl: 'https://example.com/avatar2.jpg',
        verified: true,
      });

      expect(userStep2.id).toBe(userStep1.id); // Same record merged!
      expect(userStep2.nickname).toBe('Hero Level 2 Updated');
      expect(userStep2.avatarUrl).toBe('https://example.com/avatar2.jpg');
      expect(userStep2.verified).toBe(true);
      expect(userStep2.identityQuality).toBe('platform_id'); // Preserved Tier 1 quality!
      expect(userStep2.platformUserId).toBe('tiktok_uid_hierarchy_01'); // Preserved platform ID!

      // Step 3: Upsert with event snapshot (neither platformUserId nor uniqueId provided)
      // Must create a new distinct user row with identityQuality = 'event_only'
      const userStep3 = await userRepo.upsertUser(tenantAId, {
        nickname: 'Anonymous Event Gifter',
        avatarUrl: 'https://example.com/anon.jpg',
      });

      expect(userStep3.id).toBeDefined();
      expect(userStep3.id).not.toBe(userStep1.id);
      expect(userStep3.identityQuality).toBe('event_only');
      expect(userStep3.platformUserId).toBeNull();
      expect(userStep3.uniqueId).toBeNull();
      expect(userStep3.nickname).toBe('Anonymous Event Gifter');

      // Verify database counts
      const foundStep1 = await userRepo.findById(tenantAId, userStep1.id);
      const foundStep3 = await userRepo.findById(tenantAId, userStep3.id);
      expect(foundStep1?.nickname).toBe('Hero Level 2 Updated');
      expect(foundStep3?.nickname).toBe('Anonymous Event Gifter');
    });

    it('creates handle_fallback when starting with uniqueId only, preserving tier on updates', async () => {
      // Step 1: Create user with only uniqueId (Tier 2)
      const userHandle = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'handle_only_streamer',
        nickname: 'Handle Initial',
      });

      expect(userHandle.identityQuality).toBe('handle_fallback');
      expect(userHandle.platformUserId).toBeNull();
      expect(userHandle.uniqueId).toBe('handle_only_streamer');

      // Step 2: Update with handle only
      const userHandleUpdated = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'handle_only_streamer',
        nickname: 'Handle Updated',
      });

      expect(userHandleUpdated.id).toBe(userHandle.id);
      expect(userHandleUpdated.nickname).toBe('Handle Updated');
      expect(userHandleUpdated.identityQuality).toBe('handle_fallback');
    });

    it('enforces partial unique index on platform_user_id per tenant at DB engine level', async () => {
      const pUserId = 'p_uid_constraint_test';

      // First user with platformUserId in Tenant A
      await userRepo.upsertUser(tenantAId, {
        platformUserId: pUserId,
        uniqueId: 'user_a1',
      });

      // Direct raw insert bypassing repository trying to insert duplicate platform_user_id in Tenant A
      await expect(
        prisma.user.create({
          data: {
            tenantId: tenantAId,
            platform: 'tiktok',
            platformUserId: pUserId,
            uniqueId: 'user_a2',
            identityQuality: 'platform_id',
          },
        })
      ).rejects.toThrow();

      // But inserting same platform_user_id in Tenant B MUST SUCCEED (tenant isolation)
      const userInB = await prisma.user.create({
        data: {
          tenantId: tenantBId,
          platform: 'tiktok',
          platformUserId: pUserId,
          uniqueId: 'user_b1',
          identityQuality: 'platform_id',
        },
      });
      expect(userInB.id).toBeDefined();
    });
  });

  // =========================================================================
  // OBJECTIVE 3: Cursor pagination correctness
  // =========================================================================
  describe('Objective 3: Cursor Pagination Correctness', () => {
    let paginationSessionId: string;
    const TOTAL_EVENTS = 25;
    const PAGE_SIZE = 5;
    const insertedEventIds: string[] = [];

    beforeAll(async () => {
      const session = await sessionRepo.create(tenantAId, {
        creatorUsername: 'pagination_tester',
      });
      paginationSessionId = session.id;

      // Base timestamp fixed in past so events have distinct, sequential receivedAt timestamps
      const baseTime = Date.now() - 100000;

      for (let i = 0; i < TOTAL_EVENTS; i++) {
        // Event i has receivedAt = baseTime + (i * 1000)
        // Event 0 is oldest, Event 24 is newest
        const event = await eventRepo.createEvent(tenantAId, {
          sessionId: paginationSessionId,
          eventType: 'chat',
          occurredAt: new Date(baseTime + i * 1000),
          receivedAt: new Date(baseTime + i * 1000),
          data: { sequenceIndex: i, text: `Message index ${i}` },
        });
        insertedEventIds.push(event.id);
      }
    });

    it('paginates 25 test events with limit=5 without duplicates, omissions, or sorting anomalies', async () => {
      const collectedEvents: Event[] = [];
      let currentCursor: string | undefined = undefined;
      let pageCount = 0;

      while (true) {
        pageCount++;
        const result = await eventRepo.listBySession(
          tenantAId,
          paginationSessionId,
          { limit: PAGE_SIZE, cursor: currentCursor }
        );

        collectedEvents.push(...result.items);

        // Verify page bounds
        if (result.meta.hasMore) {
          expect(result.items.length).toBe(PAGE_SIZE);
          expect(result.meta.nextCursor).not.toBeNull();
          currentCursor = result.meta.nextCursor!;
        } else {
          // Final page: items <= PAGE_SIZE and nextCursor is null
          expect(result.items.length).toBeLessThanOrEqual(PAGE_SIZE);
          expect(result.meta.nextCursor).toBeNull();
          break;
        }

        // Circuit breaker against infinite pagination loops
        if (pageCount > 10) {
          throw new Error('Exceeded max page limit - potential infinite pagination loop!');
        }
      }

      // 1. Total events count matches exactly
      expect(collectedEvents.length).toBe(TOTAL_EVENTS);
      expect(pageCount).toBe(5); // 25 / 5 = exactly 5 pages

      // 2. Zero duplicates: Set of IDs must equal total count
      const collectedIds = collectedEvents.map((e) => e.id);
      const uniqueIds = new Set(collectedIds);
      expect(uniqueIds.size).toBe(TOTAL_EVENTS);

      // 3. Zero omissions: All inserted event IDs must be present
      for (const id of insertedEventIds) {
        expect(uniqueIds.has(id)).toBe(true);
      }

      // 4. Strict descending sorting order (newest first: receivedAt DESC, id DESC)
      for (let i = 0; i < collectedEvents.length - 1; i++) {
        const curr = collectedEvents[i];
        const next = collectedEvents[i + 1];

        const currTime = new Date(curr.receivedAt).getTime();
        const nextTime = new Date(next.receivedAt).getTime();

        // Must be >= because ordering is DESC
        expect(currTime).toBeGreaterThanOrEqual(nextTime);

        // If timestamps are identical, id tiebreaker must be strictly greater (UUID string comparison)
        if (currTime === nextTime) {
          expect(curr.id > next.id).toBe(true);
        }
      }

      // Sequence check: since receivedAt was baseTime + i*1000,
      // the first event retrieved should be index 24 (newest), last should be index 0 (oldest)
      expect((collectedEvents[0].data as any).sequenceIndex).toBe(24);
      expect((collectedEvents[TOTAL_EVENTS - 1].data as any).sequenceIndex).toBe(0);
    });

    it('correctly handles cursor pagination when multiple events share the EXACT same receivedAt timestamp', async () => {
      // Create session for identical timestamp stress test
      const tieSession = await sessionRepo.create(tenantAId, {
        creatorUsername: 'tie_breaker_tester',
      });

      const fixedTimestamp = new Date('2026-11-02T12:00:00.000Z');
      const TIE_COUNT = 10;
      const tieIds: string[] = [];

      for (let i = 0; i < TIE_COUNT; i++) {
        const ev = await eventRepo.createEvent(tenantAId, {
          sessionId: tieSession.id,
          eventType: 'like',
          occurredAt: fixedTimestamp,
          receivedAt: fixedTimestamp, // Exactly identical receivedAt!
          data: { tieIndex: i },
        });
        tieIds.push(ev.id);
      }

      // Paginate with limit=3 (expecting 4 pages: 3, 3, 3, 1)
      const collectedTieEvents: Event[] = [];
      let cursor: string | undefined = undefined;
      let pages = 0;

      while (true) {
        pages++;
        const res = await eventRepo.listBySession(tenantAId, tieSession.id, {
          limit: 3,
          cursor,
        });

        collectedTieEvents.push(...res.items);

        if (res.meta.hasMore) {
          cursor = res.meta.nextCursor!;
        } else {
          break;
        }

        if (pages > 10) throw new Error('Infinite loop in tie-breaker pagination');
      }

      expect(collectedTieEvents.length).toBe(TIE_COUNT);
      expect(pages).toBe(4); // 3 + 3 + 3 + 1 = 10 across 4 pages

      // Zero duplicates
      const collectedTieIds = collectedTieEvents.map((e) => e.id);
      expect(new Set(collectedTieIds).size).toBe(TIE_COUNT);

      // Verify strictly descending ID tie-breaker since receivedAt is identical
      for (let i = 0; i < collectedTieEvents.length - 1; i++) {
        expect(collectedTieEvents[i].id > collectedTieEvents[i + 1].id).toBe(true);
      }
    });

    it('recovers gracefully from malformed or corrupted cursor without crashing', async () => {
      const corruptedCursor = 'invalid_not_base64_json_string!#@$';

      // Passing corrupted cursor should decode to null and return first page safely
      const result = await eventRepo.listBySession(tenantAId, paginationSessionId, {
        limit: PAGE_SIZE,
        cursor: corruptedCursor,
      });

      expect(result.items.length).toBe(PAGE_SIZE);
      expect((result.items[0].data as any).sequenceIndex).toBe(24); // First page
    });

    it('combines cursor pagination with eventType filter without data leaks or omissions', async () => {
      const filterSession = await sessionRepo.create(tenantAId, {
        creatorUsername: 'filter_pagination_creator',
      });

      // Insert 12 events: 6 'gift', 6 'chat' alternating
      const baseTime = Date.now() - 50000;
      const giftIds: string[] = [];

      for (let i = 0; i < 12; i++) {
        const type = i % 2 === 0 ? 'gift' : 'chat';
        const ev = await eventRepo.createEvent(tenantAId, {
          sessionId: filterSession.id,
          eventType: type,
          occurredAt: new Date(baseTime + i * 1000),
          receivedAt: new Date(baseTime + i * 1000),
          data: { index: i },
        });
        if (type === 'gift') {
          giftIds.push(ev.id);
        }
      }

      // Paginate only 'gift' events with limit=2 (should yield 3 pages of 2 gifts each)
      const collectedGifts: Event[] = [];
      let cursor: string | undefined = undefined;
      let giftPages = 0;

      while (true) {
        giftPages++;
        const res = await eventRepo.listByTenant(tenantAId, {
          sessionId: filterSession.id,
          eventType: 'gift',
        }, { limit: 2, cursor });

        collectedGifts.push(...res.items);

        if (res.meta.hasMore) {
          cursor = res.meta.nextCursor!;
        } else {
          break;
        }

        if (giftPages > 10) throw new Error('Infinite loop in filtered pagination');
      }

      expect(collectedGifts.length).toBe(6);
      expect(giftPages).toBe(3); // 6 / 2 = 3 pages
      // Every single collected item must be 'gift'
      expect(collectedGifts.every((g) => g.eventType === 'gift')).toBe(true);
      // All 6 giftIds present, 0 omissions, 0 duplicates
      expect(new Set(collectedGifts.map((g) => g.id)).size).toBe(6);
      for (const gid of giftIds) {
        expect(collectedGifts.some((g) => g.id === gid)).toBe(true);
      }
    });
  });
});
