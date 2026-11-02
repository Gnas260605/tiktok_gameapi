import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  TenantRepository,
  ApiKeyRepository,
  SessionRepository,
  UserRepository,
  EventRepository,
  TenantSettingsRepository,
} from '../../src/repositories';

describe('Adversarial Challenger Multi-Tenant Security Suite (Milestone 1 Gate)', () => {
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

    // Create 2 completely isolated tenants for adversarial tests
    const tenantA = await tenantRepo.create({ name: 'Challenger Tenant Alpha', status: 'active' });
    const tenantB = await tenantRepo.create({ name: 'Challenger Tenant Beta', status: 'active' });

    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    if (tenantAId) await prisma.tenant.delete({ where: { id: tenantAId } }).catch(() => {});
    if (tenantBId) await prisma.tenant.delete({ where: { id: tenantBId } }).catch(() => {});
    await prisma.$disconnect();
  });

  // =========================================================================
  // OBJECTIVE 1: Cross-Tenant Read Operations (Zero-Knowledge / 404 Concealment)
  // =========================================================================
  describe('Objective 1: Reading another tenant resource strictly returns null or empty', () => {
    let keyB: any;
    let sessionB: any;
    let userB: any;
    let eventB: any;

    beforeAll(async () => {
      // Seed Tenant B with private data
      keyB = await apiKeyRepo.createKey(tenantBId, {
        name: 'Tenant B Private Key',
        keyPrefix: 'tik_b_sec',
        keyHash: 'hash_secret_tenant_b_adversarial',
      });

      sessionB = await sessionRepo.create(tenantBId, {
        creatorUsername: 'streamer_tenant_b_private',
        roomId: 'room_b_secret_123',
      });

      userB = await userRepo.upsertUser(tenantBId, {
        platformUserId: 'tiktok_uid_beta_999',
        uniqueId: 'beta_secret_user',
        nickname: 'Beta Secret User',
      });

      eventB = await eventRepo.createEvent(tenantBId, {
        sessionId: sessionB.id,
        userId: userB.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: { giftName: 'Rose', count: 50 },
      });
    });

    it('Cross-tenant Session Read: findById(tenantA, sessionB.id) returns null', async () => {
      const result = await sessionRepo.findById(tenantAId, sessionB.id);
      expect(result).toBeNull();
    });

    it('Cross-tenant Session Active Lookup: findActiveByCreator(tenantA, ...) returns null for Tenant B creator', async () => {
      const result = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', 'streamer_tenant_b_private');
      expect(result).toBeNull();
    });

    it('Cross-tenant Session List: list(tenantA) does not leak Tenant B session', async () => {
      const listA = await sessionRepo.list(tenantAId);
      expect(listA.items.some((s) => s.id === sessionB.id)).toBe(false);
    });

    it('Cross-tenant User Read: findById(tenantA, userB.id) returns null', async () => {
      const result = await userRepo.findById(tenantAId, userB.id);
      expect(result).toBeNull();
    });

    it('Cross-tenant User List & Search: listByTenant(tenantA) does not leak Tenant B user', async () => {
      const listA = await userRepo.listByTenant(tenantAId);
      expect(listA.items.some((u) => u.id === userB.id)).toBe(false);

      const searchA = await userRepo.listByTenant(tenantAId, { search: 'beta_secret_user' });
      expect(searchA.items.length).toBe(0);
    });

    it('Cross-tenant Event Read: findById(tenantA, eventB.id) returns null', async () => {
      const result = await eventRepo.findById(tenantAId, eventB.id);
      expect(result).toBeNull();
    });

    it('Cross-tenant Event List: listByTenant(tenantA) does not leak Tenant B event', async () => {
      const listA = await eventRepo.listByTenant(tenantAId);
      expect(listA.items.some((e) => e.id === eventB.id)).toBe(false);

      const listBySession = await eventRepo.listBySession(tenantAId, sessionB.id);
      expect(listBySession.items.length).toBe(0);

      const listByUser = await eventRepo.listByUser(tenantAId, userB.id);
      expect(listByUser.items.length).toBe(0);
    });

    it('Cross-tenant API Key Read: findById(tenantA, keyB.id) returns null', async () => {
      const result = await apiKeyRepo.findById(tenantAId, keyB.id);
      expect(result).toBeNull();
    });

    it('Cross-tenant API Key List: listByTenant(tenantA) does not leak Tenant B key', async () => {
      const listA = await apiKeyRepo.listByTenant(tenantAId);
      expect(listA.some((k) => k.id === keyB.id)).toBe(false);
    });

    it('Cross-tenant TenantSettings Read: getSettings(tenantA) does not leak Tenant B proprietary settings', async () => {
      await tenantSettingsRepo.upsertSettings(tenantBId, {
        eventRetentionDays: 60,
        settings: { secretApiKey: 'top-secret-beta-config' },
      });
      const settingsA = await tenantSettingsRepo.getSettings(tenantAId);
      expect((settingsA?.settings as any)?.secretApiKey).toBeUndefined();
    });
  });

  // =========================================================================
  // OBJECTIVE 2: User Deletion Cross-Tenant Isolation
  // =========================================================================
  describe('Objective 2: Deleting a user in Tenant A does not touch or affect Tenant B', () => {
    it('Tenant A cannot delete Tenant B user via userRepo.deleteUser (returns false, user unchanged)', async () => {
      const userB = await userRepo.upsertUser(tenantBId, {
        platformUserId: 'tiktok_uid_delete_attack_target',
        uniqueId: 'target_b_user',
        nickname: 'Target User in Beta',
      });

      // Tenant A attempts to delete Tenant B's user
      const deleteResult = await userRepo.deleteUser(tenantAId, userB.id);
      expect(deleteResult).toBe(false);

      // Verify user in Tenant B is completely intact
      const freshUserB = await userRepo.findById(tenantBId, userB.id);
      expect(freshUserB).not.toBeNull();
      expect(freshUserB?.id).toBe(userB.id);
      expect(freshUserB?.nickname).toBe('Target User in Beta');
    });

    it('Tenant A deleting its user with shared platformUserId does not touch Tenant B user or events', async () => {
      const sharedPlatformUserId = 'tiktok_global_user_shared_deletion';

      // 1. Both tenants observe the same TikTok user
      const userInA = await userRepo.upsertUser(tenantAId, {
        platformUserId: sharedPlatformUserId,
        uniqueId: 'shared_viewer',
        nickname: 'Viewer in Alpha',
      });

      const userInB = await userRepo.upsertUser(tenantBId, {
        platformUserId: sharedPlatformUserId,
        uniqueId: 'shared_viewer',
        nickname: 'Viewer in Beta',
      });

      expect(userInA.id).not.toBe(userInB.id);

      // 2. Both tenants create sessions and events associated with this user
      const sessionA = await sessionRepo.create(tenantAId, { creatorUsername: 'streamer_a_del_test' });
      const sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'streamer_b_del_test' });

      const eventA = await eventRepo.createEvent(tenantAId, {
        sessionId: sessionA.id,
        userId: userInA.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Hello from Tenant A' },
      });

      const eventB = await eventRepo.createEvent(tenantBId, {
        sessionId: sessionB.id,
        userId: userInB.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Hello from Tenant B' },
      });

      expect(eventA.userId).toBe(userInA.id);
      expect(eventB.userId).toBe(userInB.id);

      // 3. Tenant A deletes its user
      const deleteSuccess = await userRepo.deleteUser(tenantAId, userInA.id);
      expect(deleteSuccess).toBe(true);

      // 4. Verification in Tenant A:
      // - User A is deleted
      const foundA = await userRepo.findById(tenantAId, userInA.id);
      expect(foundA).toBeNull();

      // - Event in Tenant A has userId set to NULL (PostgreSQL composite FK ON DELETE SET NULL)
      const freshEventA = await prisma.event.findUnique({ where: { id: eventA.id } });
      expect(freshEventA).not.toBeNull();
      expect(freshEventA?.tenantId).toBe(tenantAId);
      expect(freshEventA?.userId).toBeNull(); // Set to null safely!

      // 5. Verification in Tenant B (COMPLETELY UNTOUCHED):
      // - User B is still intact
      const freshUserB = await userRepo.findById(tenantBId, userInB.id);
      expect(freshUserB).not.toBeNull();
      expect(freshUserB?.id).toBe(userInB.id);
      expect(freshUserB?.platformUserId).toBe(sharedPlatformUserId);
      expect(freshUserB?.nickname).toBe('Viewer in Beta');

      // - Event B still has userId intact (NOT nullified!)
      const freshEventB = await prisma.event.findUnique({ where: { id: eventB.id } });
      expect(freshEventB).not.toBeNull();
      expect(freshEventB?.tenantId).toBe(tenantBId);
      expect(freshEventB?.userId).toBe(userInB.id);

      // - User B is still listed in Tenant B
      const listB = await userRepo.listByTenant(tenantBId);
      expect(listB.items.some((u) => u.id === userInB.id)).toBe(true);

      // 6. Tenant A can re-observe the same platform user afterwards without conflict
      const reobservedUserA = await userRepo.upsertUser(tenantAId, {
        platformUserId: sharedPlatformUserId,
        uniqueId: 'shared_viewer_reborn',
        nickname: 'Viewer Reborn in Alpha',
      });
      expect(reobservedUserA.id).toBeDefined();
      expect(reobservedUserA.id).not.toBe(userInB.id);
    });
  });

  // =========================================================================
  // OBJECTIVE 3: Cross-Tenant Event Creation Prevention (Repo + DB Foreign Keys)
  // =========================================================================
  describe('Objective 3: Creating events in Tenant A pointing to Tenant B session/user is blocked', () => {
    let sessionA: any;
    let sessionB: any;
    let userA: any;
    let userB: any;

    beforeAll(async () => {
      sessionA = await sessionRepo.create(tenantAId, { creatorUsername: 'streamer_alpha_fk' });
      sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'streamer_beta_fk' });

      userA = await userRepo.upsertUser(tenantAId, { uniqueId: 'user_alpha_fk' });
      userB = await userRepo.upsertUser(tenantBId, { uniqueId: 'user_beta_fk' });
    });

    it('Repository layer blocks Tenant A creating event with Tenant B session', async () => {
      await expect(
        eventRepo.createEvent(tenantAId, {
          sessionId: sessionB.id,
          eventType: 'like',
          occurredAt: new Date(),
          data: { count: 1 },
        })
      ).rejects.toThrow(`Session ${sessionB.id} does not belong to tenant ${tenantAId}`);
    });

    it('Repository layer blocks Tenant A creating event with Tenant B user', async () => {
      await expect(
        eventRepo.createEvent(tenantAId, {
          sessionId: sessionA.id,
          userId: userB.id,
          eventType: 'like',
          occurredAt: new Date(),
          data: { count: 1 },
        })
      ).rejects.toThrow(`User ${userB.id} does not belong to tenant ${tenantAId}`);
    });

    it('Repository layer blocks Tenant B creating event with Tenant A user', async () => {
      await expect(
        eventRepo.createEvent(tenantBId, {
          sessionId: sessionB.id,
          userId: userA.id,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { text: 'Cross-tenant attempt' },
        })
      ).rejects.toThrow(`User ${userA.id} does not belong to tenant ${tenantBId}`);
    });

    it('PostgreSQL composite FK blocks raw insert: Tenant A tenantId with Tenant B sessionId', async () => {
      let pgError: any = null;
      try {
        await prisma.event.create({
          data: {
            tenantId: tenantAId,
            sessionId: sessionB.id, // Belongs to Tenant B
            eventType: 'like',
            occurredAt: new Date(),
            data: { test: 'raw_db_fk_bypass_session' },
          },
        });
      } catch (err) {
        pgError = err;
      }

      expect(pgError).not.toBeNull();
      expect(pgError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      // P2003: Foreign key constraint failed
      expect(pgError.code).toBe('P2003');
    });

    it('PostgreSQL composite FK blocks raw insert: Tenant A tenantId with Tenant B userId', async () => {
      let pgError: any = null;
      try {
        await prisma.event.create({
          data: {
            tenantId: tenantAId,
            sessionId: sessionA.id, // Belongs to Tenant A
            userId: userB.id, // Belongs to Tenant B!
            eventType: 'like',
            occurredAt: new Date(),
            data: { test: 'raw_db_fk_bypass_user' },
          },
        });
      } catch (err) {
        pgError = err;
      }

      expect(pgError).not.toBeNull();
      expect(pgError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      // P2003: Foreign key constraint failed on composite (tenant_id, user_id)
      expect(pgError.code).toBe('P2003');
    });

    it('PostgreSQL composite FK blocks raw insert: Tenant B tenantId with Tenant A sessionId', async () => {
      let pgError: any = null;
      try {
        await prisma.event.create({
          data: {
            tenantId: tenantBId,
            sessionId: sessionA.id, // Belongs to Tenant A
            eventType: 'chat',
            occurredAt: new Date(),
            data: { test: 'raw_db_fk_bypass_reverse' },
          },
        });
      } catch (err) {
        pgError = err;
      }

      expect(pgError).not.toBeNull();
      expect(pgError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(pgError.code).toBe('P2003');
    });

    it('PostgreSQL composite FK blocks raw insert: non-existent sessionId or userId', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';

      await expect(
        prisma.event.create({
          data: {
            tenantId: tenantAId,
            sessionId: fakeUuid,
            eventType: 'chat',
            occurredAt: new Date(),
          },
        })
      ).rejects.toThrowError(Prisma.PrismaClientKnownRequestError);

      await expect(
        prisma.event.create({
          data: {
            tenantId: tenantAId,
            sessionId: sessionA.id,
            userId: fakeUuid,
            eventType: 'chat',
            occurredAt: new Date(),
          },
        })
      ).rejects.toThrowError(Prisma.PrismaClientKnownRequestError);
    });
  });

  // =========================================================================
  // OBJECTIVE 4: Cross-Tenant Mutation & State Tampering Impossibility
  // =========================================================================
  describe('Objective 4: Cross-Tenant mutations strictly fail without side effects', () => {
    it('Tenant A cannot update Tenant B session status or details', async () => {
      const sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'tamper_streamer_b' });

      const res = await sessionRepo.updateStatus(tenantAId, sessionB.id, 'ended', {
        disconnectReason: 'tampered_by_a',
      });
      expect(res).toBeNull();

      const freshB = await sessionRepo.findById(tenantBId, sessionB.id);
      expect(freshB?.status).toBe('queued');
      expect(freshB?.disconnectReason).toBeNull();
    });

    it('Tenant A cannot revoke Tenant B API key', async () => {
      const keyB = await apiKeyRepo.createKey(tenantBId, {
        name: 'Target Key B',
        keyPrefix: 'tik_b_tamper',
        keyHash: 'hash_tamper_target_beta_key',
      });

      const res = await apiKeyRepo.revokeKey(tenantAId, keyB.id);
      expect(res).toBeNull();

      const freshKey = await apiKeyRepo.findById(tenantBId, keyB.id);
      expect(freshKey?.status).toBe('active');
      expect(freshKey?.revoked).toBe(false);
    });

    it('Tenant A cannot update lastUsed timestamp on Tenant B API key', async () => {
      const keyB = await apiKeyRepo.createKey(tenantBId, {
        name: 'Target Key B LastUsed',
        keyPrefix: 'tik_b_lastused',
        keyHash: 'hash_lastused_target_beta_key',
      });

      const futureDate = new Date('2030-01-01T00:00:00Z');
      await apiKeyRepo.updateLastUsed(tenantAId, keyB.id, futureDate);

      const freshKey = await apiKeyRepo.findById(tenantBId, keyB.id);
      expect(freshKey?.lastUsedAt).toBeNull();
    });
  });
});
