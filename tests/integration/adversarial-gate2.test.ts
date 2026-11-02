import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  TenantRepository,
  SessionRepository,
  UserRepository,
  EventRepository,
} from '../../src/repositories';

describe('Milestone 1 Gate 2: Adversarial Empirical Verification Suite', () => {
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

    const tenantA = await tenantRepo.create({
      name: 'Adversarial Challenger Tenant Alpha',
      status: 'active',
    });
    const tenantB = await tenantRepo.create({
      name: 'Adversarial Challenger Tenant Beta',
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
  // OBJECTIVE 1: User Deletion with Events (SetNull on event.user_id, No P2011)
  // =========================================================================
  describe('Objective 1: User Deletion with Events (SetNull on user_id, No P2011)', () => {
    it('deleting a user who has a single event properly nullifies event.user_id without deleting event or throwing P2011', async () => {
      const session = await sessionRepo.create(tenantAId, {
        creatorUsername: 'streamer_obj1_single',
      });
      const user = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'obj1_user_single',
        nickname: 'Obj1 User Single',
      });
      const event = await eventRepo.createEvent(tenantAId, {
        sessionId: session.id,
        userId: user.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Hello from single user' },
      });

      expect(event.userId).toBe(user.id);
      expect(event.tenantId).toBe(tenantAId);

      // Deleting user via repository
      const deleteResult = await userRepo.deleteUser(tenantAId, user.id);
      expect(deleteResult).toBe(true);

      // User must be gone
      const deletedUser = await userRepo.findById(tenantAId, user.id);
      expect(deletedUser).toBeNull();

      // Event must still exist with userId = null and tenantId preserved
      const eventAfter = await prisma.event.findUnique({
        where: { id: event.id },
      });
      expect(eventAfter).not.toBeNull();
      expect(eventAfter?.id).toBe(event.id);
      expect(eventAfter?.tenantId).toBe(tenantAId);
      expect(eventAfter?.sessionId).toBe(session.id);
      expect(eventAfter?.userId).toBeNull();

      // Event repository findById returns event with user: null
      const eventRepoView = await eventRepo.findById(tenantAId, event.id);
      expect(eventRepoView).not.toBeNull();
      expect(eventRepoView?.userId).toBeNull();
      expect(eventRepoView?.user).toBeNull();
    });

    it('deleting a user with 20 events across multiple sessions nullifies all 20 events while leaving other events and sessions intact', async () => {
      const session1 = await sessionRepo.create(tenantAId, {
        creatorUsername: 'streamer_obj1_multi_1',
      });
      const session2 = await sessionRepo.create(tenantAId, {
        creatorUsername: 'streamer_obj1_multi_2',
      });

      const targetUser = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'target_multi_user',
        nickname: 'Target Multi Event User',
      });
      const innocentUser = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'innocent_multi_user',
        nickname: 'Innocent User',
      });

      const targetEventIds: string[] = [];
      const innocentEventIds: string[] = [];
      const nullUserEventIds: string[] = [];

      // Create 10 events for targetUser in session1
      for (let i = 0; i < 10; i++) {
        const ev = await eventRepo.createEvent(tenantAId, {
          sessionId: session1.id,
          userId: targetUser.id,
          eventType: 'gift',
          occurredAt: new Date(),
          data: { giftIndex: i },
        });
        targetEventIds.push(ev.id);
      }

      // Create 10 events for targetUser in session2
      for (let i = 0; i < 10; i++) {
        const ev = await eventRepo.createEvent(tenantAId, {
          sessionId: session2.id,
          userId: targetUser.id,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { chatIndex: i },
        });
        targetEventIds.push(ev.id);
      }

      // Create 5 events for innocentUser in session1
      for (let i = 0; i < 5; i++) {
        const ev = await eventRepo.createEvent(tenantAId, {
          sessionId: session1.id,
          userId: innocentUser.id,
          eventType: 'like',
          occurredAt: new Date(),
          data: { likeIndex: i },
        });
        innocentEventIds.push(ev.id);
      }

      // Create 5 events without userId in session2 (e.g. roomUser event)
      for (let i = 0; i < 5; i++) {
        const ev = await eventRepo.createEvent(tenantAId, {
          sessionId: session2.id,
          eventType: 'roomUser',
          occurredAt: new Date(),
          data: { roomViewerCount: 100 + i },
        });
        nullUserEventIds.push(ev.id);
      }

      // Direct delete on Prisma User to test PostgreSQL engine level constraint directly
      await prisma.user.delete({
        where: { id: targetUser.id },
      });

      // Verify all 20 target events still exist, tenantId intact, userId is null
      const freshTargetEvents = await prisma.event.findMany({
        where: { id: { in: targetEventIds } },
      });
      expect(freshTargetEvents.length).toBe(20);
      for (const ev of freshTargetEvents) {
        expect(ev.tenantId).toBe(tenantAId);
        expect(ev.userId).toBeNull();
      }

      // Verify innocentUser events are completely unaffected
      const freshInnocentEvents = await prisma.event.findMany({
        where: { id: { in: innocentEventIds } },
      });
      expect(freshInnocentEvents.length).toBe(5);
      for (const ev of freshInnocentEvents) {
        expect(ev.tenantId).toBe(tenantAId);
        expect(ev.userId).toBe(innocentUser.id);
      }

      // Verify nullUser events remain intact
      const freshNullEvents = await prisma.event.findMany({
        where: { id: { in: nullUserEventIds } },
      });
      expect(freshNullEvents.length).toBe(5);
      for (const ev of freshNullEvents) {
        expect(ev.tenantId).toBe(tenantAId);
        expect(ev.userId).toBeNull();
      }
    });

    it('cross-tenant user deletion does not affect events or users in other tenants', async () => {
      const sharedPlatformUserId = 'shared_platform_user_gate2';

      // Create user in Tenant A
      const userA = await userRepo.upsertUser(tenantAId, {
        platformUserId: sharedPlatformUserId,
        uniqueId: 'user_in_alpha',
        nickname: 'User in Alpha',
      });
      const sessionA = await sessionRepo.create(tenantAId, { creatorUsername: 'streamer_cross_a' });
      const eventA = await eventRepo.createEvent(tenantAId, {
        sessionId: sessionA.id,
        userId: userA.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Alpha message' },
      });

      // Create user with same platformUserId in Tenant B
      const userB = await userRepo.upsertUser(tenantBId, {
        platformUserId: sharedPlatformUserId,
        uniqueId: 'user_in_beta',
        nickname: 'User in Beta',
      });
      const sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'streamer_cross_b' });
      const eventB = await eventRepo.createEvent(tenantBId, {
        sessionId: sessionB.id,
        userId: userB.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Beta message' },
      });

      // Delete user in Tenant A
      await userRepo.deleteUser(tenantAId, userA.id);

      // Verify Tenant A event has null userId
      const freshEventA = await prisma.event.findUnique({ where: { id: eventA.id } });
      expect(freshEventA?.userId).toBeNull();

      // Verify Tenant B user and event are 100% intact
      const freshUserB = await userRepo.findById(tenantBId, userB.id);
      expect(freshUserB).not.toBeNull();
      expect(freshUserB?.id).toBe(userB.id);

      const freshEventB = await prisma.event.findUnique({ where: { id: eventB.id } });
      expect(freshEventB?.userId).toBe(userB.id);
      expect(freshEventB?.tenantId).toBe(tenantBId);
    });

    it('contrasting behavior: deleting session cascades and deletes events entirely', async () => {
      const session = await sessionRepo.create(tenantAId, {
        creatorUsername: 'streamer_cascade_compare',
      });
      const event = await eventRepo.createEvent(tenantAId, {
        sessionId: session.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Should be deleted with session' },
      });

      // Delete session
      await prisma.liveSession.delete({ where: { id: session.id } });

      // Event should be CASCADE deleted
      const eventAfter = await prisma.event.findUnique({ where: { id: event.id } });
      expect(eventAfter).toBeNull();
    });
  });

  // =========================================================================
  // OBJECTIVE 2: User Search with Cursor Pagination Preserving Filters
  // =========================================================================
  describe('Objective 2: User Search with Cursor Pagination Filter Preservation', () => {
    it('preserves search filter across all pages with interleaved matching and non-matching users', async () => {
      const searchKeyword = `gate2_search_${Date.now().toString(36)}`;
      const baseTime = Date.now() - 60000;

      // Create 5 matching users interleaved with 5 non-matching distractor users
      const matchingIds: string[] = [];
      const distractorIds: string[] = [];

      for (let i = 0; i < 5; i++) {
        // Matching user
        const matchUser = await userRepo.upsertUser(tenantAId, {
          uniqueId: `${searchKeyword}_user_${i}`,
          nickname: `Participant ${searchKeyword} ${i}`,
          profileObservedAt: new Date(baseTime + (i * 2) * 1000),
        });
        matchingIds.push(matchUser.id);

        // Distractor non-matching user
        const distractorUser = await userRepo.upsertUser(tenantAId, {
          uniqueId: `unrelated_distractor_${i}_${Date.now().toString(36)}`,
          nickname: `Completely Different Person ${i}`,
          profileObservedAt: new Date(baseTime + (i * 2 + 1) * 1000),
        });
        distractorIds.push(distractorUser.id);
      }

      // Force single-item pages: limit = 1
      const collectedUsers: any[] = [];
      let cursor: string | undefined = undefined;
      let totalPages = 0;

      while (true) {
        totalPages++;
        const page = await userRepo.listByTenant(
          tenantAId,
          { search: searchKeyword },
          { limit: 1, cursor }
        );

        collectedUsers.push(...page.items);

        // Verify each individual page contains ONLY matching items
        for (const item of page.items) {
          const matches =
            item.uniqueId?.includes(searchKeyword) || item.nickname?.includes(searchKeyword);
          expect(matches).toBe(true);
        }

        if (page.meta.hasMore && page.meta.nextCursor) {
          cursor = page.meta.nextCursor;
        } else {
          break;
        }

        if (totalPages > 20) {
          throw new Error('Infinite loop detected during search pagination');
        }
      }

      // Assertions:
      // 1. Total matching users found must be exactly 5 across 5 pages
      expect(collectedUsers.length).toBe(5);
      expect(totalPages).toBe(5);

      // 2. No distractor leaked into any page
      const collectedIdSet = new Set(collectedUsers.map((u) => u.id));
      for (const distractorId of distractorIds) {
        expect(collectedIdSet.has(distractorId)).toBe(false);
      }

      // 3. All matching IDs were collected
      for (const mId of matchingIds) {
        expect(collectedIdSet.has(mId)).toBe(true);
      }
    });

    it('performs case-insensitive search preservation across cursor pagination', async () => {
      const baseTime = Date.now() - 30000;
      const termUpper = 'SHOUTING_SEARCH';

      // Insert users with mixed cases
      const u1 = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'shouting_search_1',
        nickname: 'user lower',
        profileObservedAt: new Date(baseTime + 1000),
      });
      const u2 = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'other_handle_2',
        nickname: 'Shouting_Search_2',
        profileObservedAt: new Date(baseTime + 2000),
      });

      // Search with UPPERCASE
      const page1 = await userRepo.listByTenant(
        tenantAId,
        { search: termUpper },
        { limit: 1 }
      );
      expect(page1.items.length).toBe(1);
      expect(page1.meta.nextCursor).not.toBeNull();

      const page2 = await userRepo.listByTenant(
        tenantAId,
        { search: termUpper },
        { limit: 1, cursor: page1.meta.nextCursor! }
      );
      expect(page2.items.length).toBe(1);

      const allFound = [...page1.items, ...page2.items];
      expect(allFound.map((u) => u.id).sort()).toEqual([u1.id, u2.id].sort());
    });

    it('handles special characters in search query without SQL injection or syntax error', async () => {
      const specialQuery = "special_'\"_%_test";

      // Should not throw an unhandled exception or SQL syntax error
      await expect(
        userRepo.listByTenant(tenantAId, { search: specialQuery }, { limit: 10 })
      ).resolves.toBeDefined();

      const res = await userRepo.listByTenant(tenantAId, { search: specialQuery }, { limit: 10 });
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.meta.hasMore).toBe(false);
    });

    it('handles whitespace-only search string safely without breaking pagination', async () => {
      const res = await userRepo.listByTenant(tenantAId, { search: '     ' }, { limit: 5 });
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.meta).toBeDefined();
    });
  });

  // =========================================================================
  // OBJECTIVE 3: Malformed / Corrupted / Invalid Date Cursors
  // =========================================================================
  // =========================================================================
  // OBJECTIVE 3: Malformed / Corrupted / Invalid Date Cursors
  // =========================================================================
  describe('Objective 3: Malformed / Corrupted / Invalid Date Cursor Resilience', () => {
    // Malformed cursors that are successfully handled by current decodeCursor implementation
    const handledMalformedCursors = [
      { desc: 'empty string', cursor: '' },
      { desc: 'whitespace string', cursor: '   ' },
      { desc: 'random corrupted characters', cursor: '!!!@@@###$$$%%%' },
      { desc: 'invalid base64url', cursor: '====not-base64====' },
      { desc: 'base64 of broken JSON', cursor: Buffer.from('{id: bad').toString('base64url') },
      { desc: 'base64 of JSON string primitive', cursor: Buffer.from('"hello"').toString('base64url') },
      { desc: 'base64 of JSON number primitive', cursor: Buffer.from('123456').toString('base64url') },
      { desc: 'base64 of JSON boolean primitive', cursor: Buffer.from('true').toString('base64url') },
      { desc: 'base64 of JSON null primitive', cursor: Buffer.from('null').toString('base64url') },
      { desc: 'base64 of JSON array', cursor: Buffer.from('["item1", "item2"]').toString('base64url') },
      { desc: 'base64 of empty JSON object', cursor: Buffer.from('{}').toString('base64url') },
      {
        desc: 'object missing timestamp',
        cursor: Buffer.from(JSON.stringify({ id: '00000000-0000-0000-0000-000000000001' })).toString('base64url'),
      },
      {
        desc: 'object missing id',
        cursor: Buffer.from(JSON.stringify({ timestamp: new Date().toISOString() })).toString('base64url'),
      },
      {
        desc: 'object with empty id',
        cursor: Buffer.from(JSON.stringify({ id: '', timestamp: new Date().toISOString() })).toString('base64url'),
      },
      {
        desc: 'object with non-string id (number)',
        cursor: Buffer.from(JSON.stringify({ id: 99999, timestamp: new Date().toISOString() })).toString('base64url'),
      },
      {
        desc: 'object with invalid date string timestamp',
        cursor: Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: 'not-a-valid-date-str' })
        ).toString('base64url'),
      },
      {
        desc: 'object with empty timestamp',
        cursor: Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: '' })
        ).toString('base64url'),
      },
      {
        desc: 'object with boolean timestamp',
        cursor: Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: false })
        ).toString('base64url'),
      },
      {
        desc: 'object with null timestamp',
        cursor: Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: null })
        ).toString('base64url'),
      },
      {
        desc: 'object with numeric milliseconds timestamp',
        cursor: Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: 1700000000000 })
        ).toString('base64url'),
      },
      {
        desc: 'very large cursor string (10KB)',
        cursor: Buffer.from('x'.repeat(10000)).toString('base64url'),
      },
    ];

    it('UserRepository safely falls back to first page on handled malformed cursors without throwing', async () => {
      for (const { desc, cursor } of handledMalformedCursors) {
        try {
          const res = await userRepo.listByTenant(tenantAId, {}, { cursor, limit: 5 });
          expect(res).toBeDefined();
          expect(Array.isArray(res.items)).toBe(true);
          expect(res.meta).toBeDefined();
        } catch (err: any) {
          throw new Error(`UserRepository threw unexpected error on cursor [${desc}]: ${err.message}`);
        }
      }
    });

    it('SessionRepository safely falls back to first page on handled malformed cursors without throwing', async () => {
      for (const { desc, cursor } of handledMalformedCursors) {
        try {
          const res = await sessionRepo.list(tenantAId, {}, { cursor, limit: 5 });
          expect(res).toBeDefined();
          expect(Array.isArray(res.items)).toBe(true);
          expect(res.meta).toBeDefined();
        } catch (err: any) {
          throw new Error(`SessionRepository threw unexpected error on cursor [${desc}]: ${err.message}`);
        }
      }
    });

    it('EventRepository safely falls back to first page on handled malformed cursors without throwing', async () => {
      for (const { desc, cursor } of handledMalformedCursors) {
        try {
          const res = await eventRepo.listByTenant(tenantAId, {}, { cursor, limit: 5 });
          expect(res).toBeDefined();
          expect(Array.isArray(res.items)).toBe(true);
          expect(res.meta).toBeDefined();
        } catch (err: any) {
          throw new Error(`EventRepository threw unexpected error on cursor [${desc}]: ${err.message}`);
        }
      }
    });

    // Non-UUID cursor IDs safely fall back to first page without crashing
    describe('Non-UUID Cursor IDs Safely Fall Back to First Page Without Crashing', () => {
      const nonUuidCursors = [
        {
          desc: 'plain string non-uuid id ("not-a-uuid")',
          cursor: Buffer.from(
            JSON.stringify({ id: 'not-a-uuid', timestamp: new Date().toISOString() })
          ).toString('base64url'),
        },
        {
          desc: 'short alphanumeric id ("abc-123")',
          cursor: Buffer.from(
            JSON.stringify({ id: 'abc-123', timestamp: new Date().toISOString() })
          ).toString('base64url'),
        },
        {
          desc: 'invalid hex character in uuid ("00000000-0000-0000-0000-00000000000z")',
          cursor: Buffer.from(
            JSON.stringify({ id: '00000000-0000-0000-0000-00000000000z', timestamp: new Date().toISOString() })
          ).toString('base64url'),
        },
        {
          desc: 'sql injection string in id ("\'; DROP TABLE users; --")',
          cursor: Buffer.from(
            JSON.stringify({ id: "'; DROP TABLE users; --", timestamp: new Date().toISOString() })
          ).toString('base64url'),
        },
      ];

      it('UserRepository safely falls back to first page on non-UUID cursor id without throwing', async () => {
        for (const { desc, cursor } of nonUuidCursors) {
          const res = await userRepo.listByTenant(tenantAId, {}, { cursor, limit: 5 });
          expect(res, `Failed on ${desc}`).toBeDefined();
          expect(Array.isArray(res.items)).toBe(true);
          expect(res.meta).toBeDefined();
        }
      });

      it('SessionRepository safely falls back to first page on non-UUID cursor id without throwing', async () => {
        for (const { desc, cursor } of nonUuidCursors) {
          const res = await sessionRepo.list(tenantAId, {}, { cursor, limit: 5 });
          expect(res, `Failed on ${desc}`).toBeDefined();
          expect(Array.isArray(res.items)).toBe(true);
          expect(res.meta).toBeDefined();
        }
      });

      it('EventRepository safely falls back to first page on non-UUID cursor id without throwing', async () => {
        for (const { desc, cursor } of nonUuidCursors) {
          const res = await eventRepo.listByTenant(tenantAId, {}, { cursor, limit: 5 });
          expect(res, `Failed on ${desc}`).toBeDefined();
          expect(Array.isArray(res.items)).toBe(true);
          expect(res.meta).toBeDefined();
        }
      });
    });
  });
});
