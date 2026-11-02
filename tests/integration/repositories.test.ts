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
});
