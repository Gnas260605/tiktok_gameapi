import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  TenantRepository,
  ApiKeyRepository,
  SessionRepository,
  UserRepository,
  EventRepository,
  TenantSettingsRepository,
} from '../../src/repositories';

describe('Repository Layer Multi-Tenant Isolation Suite', () => {
  let prisma: PrismaClient;
  let tenantRepo: TenantRepository;
  let apiKeyRepo: ApiKeyRepository;
  let sessionRepo: SessionRepository;
  let userRepo: UserRepository;
  let eventRepo: EventRepository;
  let tenantSettingsRepo: TenantSettingsRepository;

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    tenantRepo = new TenantRepository(prisma);
    apiKeyRepo = new ApiKeyRepository(prisma);
    sessionRepo = new SessionRepository(prisma);
    userRepo = new UserRepository(prisma);
    eventRepo = new EventRepository(prisma);
    tenantSettingsRepo = new TenantSettingsRepository(prisma);

    // Create 2 isolated test tenants
    const tenantA = await tenantRepo.create({ name: 'Acme Test Corp', status: 'active' });
    const tenantB = await tenantRepo.create({ name: 'Beta Streamers Test', status: 'active' });

    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    // Cascade delete test tenants and their isolated data
    if (tenantAId) await prisma.tenant.delete({ where: { id: tenantAId } }).catch(() => {});
    if (tenantBId) await prisma.tenant.delete({ where: { id: tenantBId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('TenantRepository', () => {
    it('verifies active status and isolates tenant lookup', async () => {
      expect(await tenantRepo.isActive(tenantAId)).toBe(true);
      expect(await tenantRepo.isActive(tenantBId)).toBe(true);
      expect(await tenantRepo.isActive('00000000-0000-0000-0000-000000000000')).toBe(false);

      const foundA = await tenantRepo.findById(tenantAId);
      expect(foundA).not.toBeNull();
      expect(foundA?.name).toBe('Acme Test Corp');

      const foundFake = await tenantRepo.findById('00000000-0000-0000-0000-000000000000');
      expect(foundFake).toBeNull();
    });

    it('updates tenant status and checks suspension', async () => {
      const tempTenant = await tenantRepo.create({ name: 'Temp Tenant', status: 'active' });
      expect(await tenantRepo.isActive(tempTenant.id)).toBe(true);

      await tenantRepo.updateStatus(tempTenant.id, 'suspended');
      expect(await tenantRepo.isActive(tempTenant.id)).toBe(false);

      // Clean up
      await prisma.tenant.delete({ where: { id: tempTenant.id } });
    });
  });

  describe('ApiKeyRepository Isolation', () => {
    it('Tenant A cannot view, list, or revoke Tenant B keys', async () => {
      const keyA = await apiKeyRepo.createKey(tenantAId, {
        name: 'Key A',
        keyPrefix: 'tik_live_a1',
        keyHash: 'hash_a1_sha256_unique_string_1',
      });

      const keyB = await apiKeyRepo.createKey(tenantBId, {
        name: 'Key B',
        keyPrefix: 'tik_live_b1',
        keyHash: 'hash_b1_sha256_unique_string_2',
      });

      // Tenant A can find Key A
      expect(await apiKeyRepo.findById(tenantAId, keyA.id)).not.toBeNull();

      // Tenant A CANNOT find Key B
      expect(await apiKeyRepo.findById(tenantAId, keyB.id)).toBeNull();

      // Tenant A list does not contain Key B
      const listA = await apiKeyRepo.listByTenant(tenantAId);
      expect(listA.some((k) => k.id === keyB.id)).toBe(false);
      expect(listA.some((k) => k.id === keyA.id)).toBe(true);

      // Tenant A cannot revoke Key B
      const revokeAttempt = await apiKeyRepo.revokeKey(tenantAId, keyB.id);
      expect(revokeAttempt).toBeNull();

      // Key B remains active in Tenant B
      const keyBStatus = await apiKeyRepo.findById(tenantBId, keyB.id);
      expect(keyBStatus?.status).toBe('active');
      expect(keyBStatus?.revoked).toBe(false);

      // Tenant B can revoke Key B
      const revokeSuccess = await apiKeyRepo.revokeKey(tenantBId, keyB.id);
      expect(revokeSuccess).not.toBeNull();
      expect(revokeSuccess?.status).toBe('revoked');
    });

    it('validates key by hash and handles revoked, expired, and inactive states', async () => {
      const activeKey = await apiKeyRepo.createKey(tenantAId, {
        name: 'Active Test Key',
        keyPrefix: 'tik_live_val1',
        keyHash: 'hash_val1_sha256_active',
      });

      const val1 = await apiKeyRepo.validateKey('hash_val1_sha256_active');
      expect(val1.valid).toBe(true);
      expect(val1.tenant?.id).toBe(tenantAId);

      // Revoked key validation
      await apiKeyRepo.revokeKey(tenantAId, activeKey.id);
      const val2 = await apiKeyRepo.validateKey('hash_val1_sha256_active');
      expect(val2.valid).toBe(false);
      expect(val2.reason).toBe('REVOKED');

      // Nonexistent key
      const val3 = await apiKeyRepo.validateKey('nonexistent_hash');
      expect(val3.valid).toBe(false);
      expect(val3.reason).toBe('NOT_FOUND');
    });
  });

  describe('SessionRepository Isolation', () => {
    it('Tenant A cannot access or update Tenant B sessions', async () => {
      const sessionA = await sessionRepo.create(tenantAId, {
        creatorUsername: 'streamer_alpha',
      });
      const sessionB = await sessionRepo.create(tenantBId, {
        creatorUsername: 'streamer_alpha', // Same creator in different tenant allowed!
      });

      // Tenant A cannot find Session B
      expect(await sessionRepo.findById(tenantAId, sessionB.id)).toBeNull();

      // Tenant A list contains only Session A
      const listA = await sessionRepo.list(tenantAId);
      expect(listA.items.some((s) => s.id === sessionB.id)).toBe(false);
      expect(listA.items.some((s) => s.id === sessionA.id)).toBe(true);

      // Tenant A cannot update Session B status
      const updateResult = await sessionRepo.updateStatus(tenantAId, sessionB.id, 'ended', {
        disconnectReason: 'tamper_attempt',
      });
      expect(updateResult).toBeNull();

      // Session B remains untouched in Tenant B
      const sessionBReload = await sessionRepo.findById(tenantBId, sessionB.id);
      expect(sessionBReload?.status).toBe('queued');
      expect(sessionBReload?.disconnectReason).toBeNull();
    });

    it('Active creator conflict is isolated to the tenant', async () => {
      // streamer_alpha is queued in Tenant A
      const activeA = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', 'streamer_alpha');
      expect(activeA).not.toBeNull();
      expect(activeA?.creatorUsername).toBe('streamer_alpha');

      // streamer_beta is not active in Tenant A
      const notFoundA = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', 'streamer_beta');
      expect(notFoundA).toBeNull();
    });

    it('Partial unique index blocks duplicate active sessions for same creator in same tenant', async () => {
      // streamer_unique is queued in Tenant A
      await sessionRepo.create(tenantAId, {
        creatorUsername: 'streamer_unique',
      });

      // Attempting to create another active session for the same creator in Tenant A must fail
      await expect(
        sessionRepo.create(tenantAId, {
          creatorUsername: 'streamer_unique',
        })
      ).rejects.toThrow();

      // However, creating for another creator in Tenant A succeeds
      const anotherCreator = await sessionRepo.create(tenantAId, {
        creatorUsername: 'streamer_unique_2',
      });
      expect(anotherCreator.id).toBeDefined();

      // And creating streamer_unique in Tenant B succeeds
      const sessionInB = await sessionRepo.create(tenantBId, {
        creatorUsername: 'streamer_unique',
      });
      expect(sessionInB.id).toBeDefined();
    });
  });

  describe('UserRepository Isolation', () => {
    it('Upserts same platform user independently across tenants', async () => {
      const userA = await userRepo.upsertUser(tenantAId, {
        platformUserId: 'tiktok_uid_999',
        uniqueId: 'john_doe',
        nickname: 'John In Tenant A',
        identityQuality: 'platform_id',
      });

      const userB = await userRepo.upsertUser(tenantBId, {
        platformUserId: 'tiktok_uid_999',
        uniqueId: 'john_doe',
        nickname: 'John In Tenant B',
        identityQuality: 'platform_id',
      });

      expect(userA.id).not.toBe(userB.id);
      expect(userA.tenantId).toBe(tenantAId);
      expect(userB.tenantId).toBe(tenantBId);
      expect(userA.nickname).toBe('John In Tenant A');
      expect(userB.nickname).toBe('John In Tenant B');

      // Cross-tenant lookup returns null
      expect(await userRepo.findById(tenantAId, userB.id)).toBeNull();
      expect(await userRepo.findById(tenantBId, userA.id)).toBeNull();

      // List does not leak users
      const listA = await userRepo.listByTenant(tenantAId);
      expect(listA.items.some((u) => u.id === userB.id)).toBe(false);
      expect(listA.items.some((u) => u.id === userA.id)).toBe(true);
    });

    it('Updates existing user profile without creating duplicate records on subsequent events', async () => {
      const initialUser = await userRepo.upsertUser(tenantAId, {
        platformUserId: 'tiktok_uid_repeat',
        uniqueId: 'initial_handle',
        nickname: 'Initial Name',
      });

      const updatedUser = await userRepo.upsertUser(tenantAId, {
        platformUserId: 'tiktok_uid_repeat',
        uniqueId: 'new_handle',
        nickname: 'Updated Name',
        verified: true,
      });

      expect(updatedUser.id).toBe(initialUser.id);
      expect(updatedUser.uniqueId).toBe('new_handle');
      expect(updatedUser.nickname).toBe('Updated Name');
      expect(updatedUser.verified).toBe(true);
    });

    it('Supports fallback identity tiers (handle_fallback and event_only)', async () => {
      const handleUser = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'handle_only_user',
        nickname: 'Handle Only',
      });
      expect(handleUser.identityQuality).toBe('handle_fallback');
      expect(handleUser.platformUserId).toBeNull();

      const eventOnlyUser = await userRepo.upsertUser(tenantAId, {
        nickname: 'Anonymous Viewer',
      });
      expect(eventOnlyUser.identityQuality).toBe('event_only');
      expect(eventOnlyUser.uniqueId).toBeNull();
    });

    it('deletes user scoped to tenant and handles non-existent users gracefully', async () => {
      const user = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'user_delete_test',
        nickname: 'To Be Deleted',
      });

      // Tenant B cannot delete Tenant A user
      const deletedByB = await userRepo.deleteUser(tenantBId, user.id);
      expect(deletedByB).toBe(false);

      // Non-existent ID returns false
      const nonExistent = await userRepo.deleteUser(tenantAId, '00000000-0000-0000-0000-000000000000');
      expect(nonExistent).toBe(false);

      // Tenant A can delete own user
      const deletedByA = await userRepo.deleteUser(tenantAId, user.id);
      expect(deletedByA).toBe(true);

      const foundAfter = await userRepo.findById(tenantAId, user.id);
      expect(foundAfter).toBeNull();
    });

    it('preserves search filter across multiple cursor pagination pages without leaking non-matching users', async () => {
      const searchToken = `searchtok_${Date.now().toString(36)}`;
      const baseTime = Date.now() - 30000;

      // Create 3 matching users and 2 distractor non-matching users with sequential timestamps
      const match1 = await userRepo.upsertUser(tenantAId, {
        uniqueId: `${searchToken}_alpha`,
        nickname: `Alpha ${searchToken}`,
        profileObservedAt: new Date(baseTime + 1000),
      });
      const distractor1 = await userRepo.upsertUser(tenantAId, {
        uniqueId: `distractor_one_${Date.now().toString(36)}`,
        nickname: 'Completely Unrelated Person 1',
        profileObservedAt: new Date(baseTime + 2000),
      });
      const match2 = await userRepo.upsertUser(tenantAId, {
        uniqueId: `${searchToken}_beta`,
        nickname: `Beta ${searchToken}`,
        profileObservedAt: new Date(baseTime + 3000),
      });
      const distractor2 = await userRepo.upsertUser(tenantAId, {
        uniqueId: `distractor_two_${Date.now().toString(36)}`,
        nickname: 'Completely Unrelated Person 2',
        profileObservedAt: new Date(baseTime + 4000),
      });
      const match3 = await userRepo.upsertUser(tenantAId, {
        uniqueId: `${searchToken}_gamma`,
        nickname: `Gamma ${searchToken}`,
        profileObservedAt: new Date(baseTime + 5000),
      });

      // Query with limit: 1 to force pagination across multiple cursor requests
      const collectedUsers: any[] = [];
      let cursor: string | undefined = undefined;
      let pageCount = 0;

      while (true) {
        pageCount++;
        const page = await userRepo.listByTenant(
          tenantAId,
          { search: searchToken },
          { limit: 1, cursor }
        );

        collectedUsers.push(...page.items);

        if (page.meta.hasMore && page.meta.nextCursor) {
          cursor = page.meta.nextCursor;
        } else {
          break;
        }

        if (pageCount > 10) {
          throw new Error('Infinite loop detected in user search pagination');
        }
      }

      // 1. Exactly 3 matching users retrieved across 3 pages
      expect(collectedUsers.length).toBe(3);
      expect(pageCount).toBe(3);

      // 2. All collected users must contain the search token
      for (const u of collectedUsers) {
        const inNickname = u.nickname?.includes(searchToken);
        const inUniqueId = u.uniqueId?.includes(searchToken);
        expect(inNickname || inUniqueId).toBe(true);
      }

      // 3. Distractor users must NOT be leaked on any page
      const collectedIds = new Set(collectedUsers.map((u) => u.id));
      expect(collectedIds.has(distractor1.id)).toBe(false);
      expect(collectedIds.has(distractor2.id)).toBe(false);

      // 4. All 3 matching users must be present
      expect(collectedIds.has(match1.id)).toBe(true);
      expect(collectedIds.has(match2.id)).toBe(true);
      expect(collectedIds.has(match3.id)).toBe(true);
    });
  });

  describe('EventRepository Isolation', () => {
    it('Tenant A cannot read Tenant B events and cannot inject events into Tenant B session', async () => {
      const sessionA = await sessionRepo.create(tenantAId, { creatorUsername: 'creator_event_a' });
      const sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'creator_event_b' });

      const eventA = await eventRepo.createEvent(tenantAId, {
        sessionId: sessionA.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Hello Tenant A' },
      });

      const eventB = await eventRepo.createEvent(tenantBId, {
        sessionId: sessionB.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Hello Tenant B' },
      });

      // Tenant A cannot find Event B by ID
      expect(await eventRepo.findById(tenantAId, eventB.id)).toBeNull();

      // Tenant A cannot list Event B via session query
      const listSessionB = await eventRepo.listBySession(tenantAId, sessionB.id);
      expect(listSessionB.items.length).toBe(0);

      // Tenant A tenant event list contains only Event A
      const listA = await eventRepo.listByTenant(tenantAId);
      expect(listA.items.some((e) => e.id === eventB.id)).toBe(false);
      expect(listA.items.some((e) => e.id === eventA.id)).toBe(true);

      // Attempting to create an event in Tenant A pointing to Tenant B's session MUST fail
      await expect(
        eventRepo.createEvent(tenantAId, {
          sessionId: sessionB.id,
          eventType: 'like',
          occurredAt: new Date(),
          data: {},
        })
      ).rejects.toThrow();
    });

    it('Enforces database composite foreign key when inserting raw mismatched event', async () => {
      const sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'creator_fk_test' });

      // Direct Prisma insert bypassing repository defense-in-depth:
      // Attempts to insert an event with tenantId = tenantAId, but sessionId belonging to tenantB
      await expect(
        prisma.event.create({
          data: {
            tenantId: tenantAId,
            sessionId: sessionB.id,
            eventType: 'member',
            occurredAt: new Date(),
            data: {},
          },
        })
      ).rejects.toThrow(); // PostgreSQL composite foreign key constraint violation!
    });

    it('sets event.userId to null when linked user is deleted, preserving event and tenant isolation without P2011 error', async () => {
      // 1. Create a session in tenant A
      const session = await sessionRepo.create(tenantAId, {
        creatorUsername: 'creator_fk_setnull_test',
      });

      // 2. Create a user in tenant A
      const user = await userRepo.upsertUser(tenantAId, {
        uniqueId: 'user_fk_victim',
        nickname: 'FK Victim User',
      });

      // 3. Create an event linked to that session and user
      const event = await eventRepo.createEvent(tenantAId, {
        sessionId: session.id,
        userId: user.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Message before user deletion' },
      });

      expect(event.userId).toBe(user.id);
      expect(event.tenantId).toBe(tenantAId);

      // 4. Delete the user
      // Prior to fix, this triggers PostgreSQL P2011: Null constraint violation on tenant_id
      await prisma.user.delete({
        where: { id: user.id },
      });

      // 5. Verify the user is gone
      const deletedUser = await userRepo.findById(tenantAId, user.id);
      expect(deletedUser).toBeNull();

      // 6. Verify the event still exists in the database
      const eventInDb = await prisma.event.findUnique({
        where: { id: event.id },
      });
      expect(eventInDb).not.toBeNull();
      expect(eventInDb?.id).toBe(event.id);
      expect(eventInDb?.tenantId).toBe(tenantAId); // tenant_id MUST NOT be set to NULL!
      expect(eventInDb?.sessionId).toBe(session.id); // session_id MUST NOT be set to NULL!
      expect(eventInDb?.userId).toBeNull(); // user_id MUST be set to NULL!

      // 7. Verify the event repository findById returns event with user: null
      const eventViaRepo = await eventRepo.findById(tenantAId, event.id);
      expect(eventViaRepo).not.toBeNull();
      expect(eventViaRepo?.userId).toBeNull();
      expect(eventViaRepo?.user).toBeNull();

      // 8. Verify the event is still retrieved in listBySession
      const sessionEvents = await eventRepo.listBySession(tenantAId, session.id);
      expect(sessionEvents.items.some((e) => e.id === event.id)).toBe(true);

      // 9. Verify the event is NOT returned in listByUser for the deleted user
      const userEvents = await eventRepo.listByUser(tenantAId, user.id);
      expect(userEvents.items.length).toBe(0);
    });
  });

  describe('TenantSettingsRepository', () => {
    it('manages settings per tenant in isolated fashion', async () => {
      await tenantSettingsRepo.upsertSettings(tenantAId, {
        eventRetentionDays: 60,
        maxActiveSessions: 10,
        settings: { featureFlag: true },
      });

      await tenantSettingsRepo.upsertSettings(tenantBId, {
        eventRetentionDays: 7,
        maxActiveSessions: 1,
        settings: { featureFlag: false },
      });

      const settingsA = await tenantSettingsRepo.getSettings(tenantAId);
      const settingsB = await tenantSettingsRepo.getSettings(tenantBId);

      expect(settingsA?.eventRetentionDays).toBe(60);
      expect(settingsA?.maxActiveSessions).toBe(10);
      expect((settingsA?.settings as any)?.featureFlag).toBe(true);

      expect(settingsB?.eventRetentionDays).toBe(7);
      expect(settingsB?.maxActiveSessions).toBe(1);
      expect((settingsB?.settings as any)?.featureFlag).toBe(false);
    });
  });

  describe('Cursor Robustness and Malformed Input Handling', () => {
    it('gracefully handles corrupted, non-JSON, and invalid timestamp cursors across all repositories', async () => {
      const corruptCursors = [
        // 1. Random corrupted string (not base64)
        'not_base64_garbage_%^&*',
        // 2. Valid base64 but not JSON
        Buffer.from('not valid json content', 'utf8').toString('base64url'),
        // 3. Valid JSON but missing required fields
        Buffer.from(JSON.stringify({ randomField: 123 }), 'utf8').toString('base64url'),
        // 4. Valid JSON with string timestamp that is NOT a valid date
        Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: 'not-a-valid-date' }),
          'utf8'
        ).toString('base64url'),
        // 5. Valid JSON with numeric timestamp
        Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: 1234567890 }),
          'utf8'
        ).toString('base64url'),
        // 6. Valid JSON with empty string timestamp
        Buffer.from(
          JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', timestamp: '' }),
          'utf8'
        ).toString('base64url'),
      ];

      for (const badCursor of corruptCursors) {
        // 1. SessionRepository must not throw; must fall back to first page
        await expect(
          sessionRepo.list(tenantAId, {}, { cursor: badCursor, limit: 10 })
        ).resolves.toBeDefined();
        const sessionRes = await sessionRepo.list(tenantAId, {}, { cursor: badCursor, limit: 10 });
        expect(Array.isArray(sessionRes.items)).toBe(true);
        expect(sessionRes.meta).toBeDefined();

        // 2. UserRepository must not throw; must fall back to first page
        await expect(
          userRepo.listByTenant(tenantAId, {}, { cursor: badCursor, limit: 10 })
        ).resolves.toBeDefined();
        const userRes = await userRepo.listByTenant(tenantAId, {}, { cursor: badCursor, limit: 10 });
        expect(Array.isArray(userRes.items)).toBe(true);
        expect(userRes.meta).toBeDefined();

        // 3. EventRepository must not throw; must fall back to first page
        await expect(
          eventRepo.listByTenant(tenantAId, {}, { cursor: badCursor, limit: 10 })
        ).resolves.toBeDefined();
        const eventRes = await eventRepo.listByTenant(tenantAId, {}, { cursor: badCursor, limit: 10 });
        expect(Array.isArray(eventRes.items)).toBe(true);
        expect(eventRes.meta).toBeDefined();
      }
    });

    it('normalizes negative, zero, and excessively large pagination limits', async () => {
      // Negative limit normalized to default (50)
      const negRes = await sessionRepo.list(tenantAId, {}, { limit: -10 });
      expect(negRes.items.length).toBeLessThanOrEqual(50);

      // Zero limit normalized to default (50)
      const zeroRes = await sessionRepo.list(tenantAId, {}, { limit: 0 });
      expect(zeroRes.items.length).toBeLessThanOrEqual(50);

      // Massive limit clamped to max (100)
      const hugeRes = await sessionRepo.list(tenantAId, {}, { limit: 999999 });
      expect(hugeRes.items.length).toBeLessThanOrEqual(100);
    });
  });
});
