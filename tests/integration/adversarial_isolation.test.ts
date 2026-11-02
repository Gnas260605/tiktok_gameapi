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

describe('Empirical Adversarial Multi-Tenant Isolation Suite', () => {
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

    // Create 2 completely isolated tenants for adversarial testing
    const tenantA = await tenantRepo.create({ name: 'Adversary Tenant Alpha', status: 'active' });
    const tenantB = await tenantRepo.create({ name: 'Victim Tenant Beta', status: 'active' });

    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    // Teardown test tenants
    if (tenantAId) await prisma.tenant.delete({ where: { id: tenantAId } }).catch(() => {});
    if (tenantBId) await prisma.tenant.delete({ where: { id: tenantBId } }).catch(() => {});
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. CROSS-TENANT READ ATTACK (404 Concealment & Query Leak Prevention)
  // =========================================================================
  describe('Attack 1: Cross-Tenant Read & Concealment', () => {
    let keyB: any;
    let sessionB: any;
    let userB: any;
    let eventB: any;

    beforeAll(async () => {
      // Seed Tenant B with sensitive resources
      keyB = await apiKeyRepo.createKey(tenantBId, {
        name: 'Tenant B Secret Key',
        keyPrefix: 'tik_victim_b',
        keyHash: 'victim_secret_hash_value_987654321',
      });

      sessionB = await sessionRepo.create(tenantBId, {
        creatorUsername: 'victim_streamer_b',
        roomId: 'room_victim_888',
      });

      userB = await userRepo.upsertUser(tenantBId, {
        platformUserId: 'tiktok_uid_victim_456',
        uniqueId: 'victim_alice',
        nickname: 'Alice Victim B',
        identityQuality: 'platform_id',
      });

      eventB = await eventRepo.createEvent(tenantBId, {
        sessionId: sessionB.id,
        userId: userB.id,
        eventType: 'gift',
        occurredAt: new Date(),
        data: { giftId: 5678, count: 10, diamondValue: 1000 },
      });

      await tenantSettingsRepo.upsertSettings(tenantBId, {
        eventRetentionDays: 90,
        maxActiveSessions: 10,
        settings: { proprietaryWebhook: 'https://victim.internal/secret' },
      });
    });

    it('Cross-tenant API Key Read: Tenant A cannot read Tenant B API key by ID (returns null)', async () => {
      const readResult = await apiKeyRepo.findById(tenantAId, keyB.id);
      expect(readResult).toBeNull();
    });

    it('Cross-tenant API Key List: Tenant A listing does not leak Tenant B key', async () => {
      const listA = await apiKeyRepo.listByTenant(tenantAId);
      expect(listA.find((k) => k.id === keyB.id)).toBeUndefined();
    });

    it('Cross-tenant Session Read: Tenant A cannot read Tenant B session by ID (returns null)', async () => {
      const readResult = await sessionRepo.findById(tenantAId, sessionB.id);
      expect(readResult).toBeNull();
    });

    it('Cross-tenant Active Session Lookup: Tenant A cannot discover Tenant B active session', async () => {
      const activeLookup = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', 'victim_streamer_b');
      expect(activeLookup).toBeNull();
    });

    it('Cross-tenant Session List: Tenant A session list does not contain Tenant B session', async () => {
      const listA = await sessionRepo.list(tenantAId);
      expect(listA.items.find((s) => s.id === sessionB.id)).toBeUndefined();
    });

    it('Cross-tenant User Read: Tenant A cannot read Tenant B user by ID (returns null)', async () => {
      const readResult = await userRepo.findById(tenantAId, userB.id);
      expect(readResult).toBeNull();
    });

    it('Cross-tenant User List & Search: Tenant A user list & search does not leak Tenant B user', async () => {
      const listA = await userRepo.listByTenant(tenantAId);
      expect(listA.items.find((u) => u.id === userB.id)).toBeUndefined();

      const searchA = await userRepo.listByTenant(tenantAId, { search: 'victim_alice' });
      expect(searchA.items.length).toBe(0);
    });

    it('Cross-tenant Event Read: Tenant A cannot read Tenant B event by ID (returns null)', async () => {
      const readResult = await eventRepo.findById(tenantAId, eventB.id);
      expect(readResult).toBeNull();
    });

    it('Cross-tenant Event List: Tenant A event list does not contain Tenant B event', async () => {
      const listA = await eventRepo.listByTenant(tenantAId);
      expect(listA.items.find((e) => e.id === eventB.id)).toBeUndefined();

      const listBySession = await eventRepo.listBySession(tenantAId, sessionB.id);
      expect(listBySession.items.length).toBe(0);

      const listByUser = await eventRepo.listByUser(tenantAId, userB.id);
      expect(listByUser.items.length).toBe(0);
    });

    it('Cross-tenant TenantSettings Read: Tenant A cannot read Tenant B proprietary settings', async () => {
      const settingsA = await tenantSettingsRepo.getSettings(tenantAId);
      // Tenant A hasn't set settings yet, or has default, but cannot see Tenant B's webhook
      expect((settingsA?.settings as any)?.proprietaryWebhook).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. CROSS-TENANT UPDATE ATTACK (Unauthorized Mutation & Tampering)
  // =========================================================================
  describe('Attack 2: Cross-Tenant Mutation & Tampering', () => {
    let targetKeyB: any;
    let targetSessionB: any;

    beforeAll(async () => {
      targetKeyB = await apiKeyRepo.createKey(tenantBId, {
        name: 'Target Key B For Revocation',
        keyPrefix: 'tik_victim_target',
        keyHash: 'victim_target_hash_654321',
      });

      targetSessionB = await sessionRepo.create(tenantBId, {
        creatorUsername: 'target_streamer_b',
        roomId: 'room_target_999',
      });
    });

    it('Tenant A cannot mutate Tenant B session status (returns null, state unmodified)', async () => {
      const mutateResult = await sessionRepo.updateStatus(tenantAId, targetSessionB.id, 'ended', {
        disconnectReason: 'attacker_forced_disconnect',
      });
      expect(mutateResult).toBeNull();

      // Verify Session B in Tenant B was NOT modified
      const freshB = await sessionRepo.findById(tenantBId, targetSessionB.id);
      expect(freshB).not.toBeNull();
      expect(freshB?.status).toBe('queued');
      expect(freshB?.disconnectReason).toBeNull();
    });

    it('Tenant A cannot revoke Tenant B API key (returns null, key stays active)', async () => {
      const revokeResult = await apiKeyRepo.revokeKey(tenantAId, targetKeyB.id);
      expect(revokeResult).toBeNull();

      // Verify Key B in Tenant B is still active and valid
      const freshKeyB = await apiKeyRepo.findById(tenantBId, targetKeyB.id);
      expect(freshKeyB).not.toBeNull();
      expect(freshKeyB?.status).toBe('active');
      expect(freshKeyB?.revoked).toBe(false);

      const validation = await apiKeyRepo.validateKey('victim_target_hash_654321');
      expect(validation.valid).toBe(true);
    });

    it('Tenant A cannot update lastUsed timestamp on Tenant B API key', async () => {
      const beforeKey = await apiKeyRepo.findById(tenantBId, targetKeyB.id);
      expect(beforeKey?.lastUsedAt).toBeNull();

      const futureDate = new Date('2028-01-01T00:00:00Z');
      await apiKeyRepo.updateLastUsed(tenantAId, targetKeyB.id, futureDate);

      const afterKey = await apiKeyRepo.findById(tenantBId, targetKeyB.id);
      expect(afterKey?.lastUsedAt).toBeNull();
    });

    it('Tenant A modifying own settings does not mutate Tenant B settings', async () => {
      await tenantSettingsRepo.upsertSettings(tenantAId, {
        eventRetentionDays: 1,
        maxActiveSessions: 1,
        settings: { attacked: true },
      });

      const settingsB = await tenantSettingsRepo.getSettings(tenantBId);
      expect(settingsB?.eventRetentionDays).toBe(90);
      expect(settingsB?.maxActiveSessions).toBe(10);
      expect((settingsB?.settings as any)?.proprietaryWebhook).toBe('https://victim.internal/secret');
    });

    it('Tenant A updating observed user profile does not corrupt Tenant B user profile', async () => {
      // Both tenants observed the same global platform user
      const sharedPlatformUserId = 'tiktok_global_user_123';

      const userB = await userRepo.upsertUser(tenantBId, {
        platformUserId: sharedPlatformUserId,
        uniqueId: 'original_victim_b',
        nickname: 'Victim True Profile',
      });

      // Tenant A tries to overwrite this user in Tenant A
      const userA = await userRepo.upsertUser(tenantAId, {
        platformUserId: sharedPlatformUserId,
        uniqueId: 'tampered_handle_a',
        nickname: 'Tampered Profile A',
      });

      expect(userA.id).not.toBe(userB.id);
      expect(userA.tenantId).toBe(tenantAId);

      // Verify Tenant B's profile is pristine
      const verifiedUserB = await userRepo.findById(tenantBId, userB.id);
      expect(verifiedUserB?.uniqueId).toBe('original_victim_b');
      expect(verifiedUserB?.nickname).toBe('Victim True Profile');
    });
  });

  // =========================================================================
  // 3. CROSS-TENANT INJECTION ATTACK (Foreign Key & Repository Enforcement)
  // =========================================================================
  describe('Attack 3: Cross-Tenant Injection & Composite Foreign Key Violations', () => {
    let sessionA: any;
    let sessionB: any;
    let userA: any;
    let userB: any;

    beforeAll(async () => {
      sessionA = await sessionRepo.create(tenantAId, { creatorUsername: 'streamer_injector_a' });
      sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'streamer_victim_b' });

      userA = await userRepo.upsertUser(tenantAId, { uniqueId: 'viewer_a', nickname: 'Viewer A' });
      userB = await userRepo.upsertUser(tenantBId, { uniqueId: 'viewer_b', nickname: 'Viewer B' });
    });

    it('Legitimate Insert: Tenant A can create event with Tenant A session and Tenant A user', async () => {
      const validEventA = await eventRepo.createEvent(tenantAId, {
        sessionId: sessionA.id,
        userId: userA.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Legitimate Tenant A event' },
      });
      expect(validEventA).toBeDefined();
      expect(validEventA.tenantId).toBe(tenantAId);
      expect(validEventA.userId).toBe(userA.id);
    });

    it('Repository Defense: Tenant A cannot create event with Tenant B session_id (throws error)', async () => {
      await expect(
        eventRepo.createEvent(tenantAId, {
          sessionId: sessionB.id,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { text: 'Cross-tenant session injection' },
        })
      ).rejects.toThrow(`Session ${sessionB.id} does not belong to tenant ${tenantAId}`);
    });

    it('Repository Defense: Tenant A cannot create event with Tenant B user_id (throws error)', async () => {
      await expect(
        eventRepo.createEvent(tenantAId, {
          sessionId: sessionA.id,
          userId: userB.id,
          eventType: 'chat',
          occurredAt: new Date(),
          data: { text: 'Cross-tenant user injection' },
        })
      ).rejects.toThrow(`User ${userB.id} does not belong to tenant ${tenantAId}`);
    });

    it('Database Engine Defense: PostgreSQL composite FK rejects raw event insert with Tenant A tenantId and Tenant B sessionId', async () => {
      // Direct Prisma query bypassing repository checks
      await expect(
        prisma.event.create({
          data: {
            tenantId: tenantAId,
            sessionId: sessionB.id,
            eventType: 'chat',
            occurredAt: new Date(),
            data: { text: 'Bypassing repo layer to inject cross-tenant event' },
          },
        })
      ).rejects.toThrowError(Prisma.PrismaClientKnownRequestError);
    });

    it('Database Engine Defense: PostgreSQL composite FK rejects raw event insert with Tenant A tenantId and Tenant B userId', async () => {
      // Direct Prisma query bypassing repository checks
      await expect(
        prisma.event.create({
          data: {
            tenantId: tenantAId,
            sessionId: sessionA.id,
            userId: userB.id, // User belongs to Tenant B!
            eventType: 'chat',
            occurredAt: new Date(),
            data: { text: 'Bypassing repo layer to inject cross-tenant user' },
          },
        })
      ).rejects.toThrowError(Prisma.PrismaClientKnownRequestError);
    });
  });

  // =========================================================================
  // 4. SAME HANDLE IN DIFFERENT TENANTS (Non-Interference Verification)
  // =========================================================================
  describe('Attack 4: Creator @alice in Tenant A and Tenant B Simultaneously', () => {
    it('Allows creator @alice to exist and stream in Tenant A and Tenant B simultaneously without conflict', async () => {
      const creatorHandle = '@alice';

      // Tenant A creates session for @alice
      const sessionAliceA = await sessionRepo.create(tenantAId, {
        creatorUsername: creatorHandle,
        roomId: 'room_alice_tenant_a',
      });
      expect(sessionAliceA).toBeDefined();
      expect(sessionAliceA.tenantId).toBe(tenantAId);
      expect(sessionAliceA.creatorUsername).toBe('alice');
      expect(sessionAliceA.status).toBe('queued');

      // Tenant B creates session for @alice simultaneously
      const sessionAliceB = await sessionRepo.create(tenantBId, {
        creatorUsername: creatorHandle,
        roomId: 'room_alice_tenant_b',
      });
      expect(sessionAliceB).toBeDefined();
      expect(sessionAliceB.tenantId).toBe(tenantBId);
      expect(sessionAliceB.creatorUsername).toBe('alice');
      expect(sessionAliceB.status).toBe('queued');

      // Verify IDs are distinct
      expect(sessionAliceA.id).not.toBe(sessionAliceB.id);

      // Verify findActiveByCreator returns each tenant's respective session
      const activeA = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', 'alice');
      const activeB = await sessionRepo.findActiveByCreator(tenantBId, 'tiktok', 'alice');

      expect(activeA?.id).toBe(sessionAliceA.id);
      expect(activeA?.roomId).toBe('room_alice_tenant_a');

      expect(activeB?.id).toBe(sessionAliceB.id);
      expect(activeB?.roomId).toBe('room_alice_tenant_b');
    });

    it('Enforces partial unique index within Tenant A while leaving Tenant B completely unimpeded', async () => {
      // In Tenant A, creating a 2nd active session for @alice must fail
      await expect(
        sessionRepo.create(tenantAId, {
          creatorUsername: '@alice',
        })
      ).rejects.toThrow();

      // Case-insensitive check: creating @ALICE in Tenant A must also fail
      await expect(
        sessionRepo.create(tenantAId, {
          creatorUsername: '@ALICE',
        })
      ).rejects.toThrow();

      // In Tenant A, transitioning @alice to 'ended' frees up the creator handle
      const activeA = await sessionRepo.findActiveByCreator(tenantAId, 'tiktok', 'alice');
      expect(activeA).not.toBeNull();
      await sessionRepo.updateStatus(tenantAId, activeA!.id, 'ended');

      // Now Tenant A can create a new session for @alice
      const newSessionA = await sessionRepo.create(tenantAId, {
        creatorUsername: '@alice',
      });
      expect(newSessionA.status).toBe('queued');

      // And Tenant B's active session for @alice is still active and undisturbed!
      const activeB = await sessionRepo.findActiveByCreator(tenantBId, 'tiktok', 'alice');
      expect(activeB?.status).toBe('queued');
      expect(activeB?.roomId).toBe('room_alice_tenant_b');
    });

    it('Allows user @alice to be observed in Tenant A and Tenant B simultaneously with independent state', async () => {
      const userAliceA = await userRepo.upsertUser(tenantAId, {
        uniqueId: '@alice',
        nickname: 'Alice in A',
      });

      const userAliceB = await userRepo.upsertUser(tenantBId, {
        uniqueId: '@alice',
        nickname: 'Alice in B',
      });

      expect(userAliceA.id).not.toBe(userAliceB.id);
      expect(userAliceA.tenantId).toBe(tenantAId);
      expect(userAliceB.tenantId).toBe(tenantBId);
      expect(userAliceA.nickname).toBe('Alice in A');
      expect(userAliceB.nickname).toBe('Alice in B');

      // Update in Tenant A doesn't mutate Tenant B
      await userRepo.upsertUser(tenantAId, {
        uniqueId: '@alice',
        nickname: 'Alice Super Star in A',
        verified: true,
      });

      const freshB = await userRepo.findById(tenantBId, userAliceB.id);
      expect(freshB?.nickname).toBe('Alice in B');
      expect(freshB?.verified).toBe(false);
    });
  });

  // =========================================================================
  // 5. ADVANCED ISOLATION & STRESS ATTACKS
  // =========================================================================
  describe('Attack 5: Advanced Isolation & Attack Vectors', () => {
    it('Stolen Cursor Tampering Attack: Tenant A queries with Tenant B event cursor, returns zero Tenant B events', async () => {
      // 1. Create event in Tenant B
      const sessionB = await sessionRepo.create(tenantBId, { creatorUsername: 'victim_cursor_streamer' });
      const eventB = await eventRepo.createEvent(tenantBId, {
        sessionId: sessionB.id,
        eventType: 'like',
        occurredAt: new Date(),
        data: { count: 42 },
      });

      // Craft cursor encoding Tenant B's event ID and timestamp
      const stolenCursor = Buffer.from(`${eventB.id}:${eventB.receivedAt.toISOString()}`).toString('base64');

      // Tenant A sends stolen cursor to eventRepo.listByTenant
      const attackerResult = await eventRepo.listByTenant(tenantAId, {}, { cursor: stolenCursor, limit: 10 });

      // None of the returned items may belong to Tenant B
      for (const item of attackerResult.items) {
        expect(item.tenantId).toBe(tenantAId);
        expect(item.id).not.toBe(eventB.id);
      }
      expect(attackerResult.items.some((i) => i.id === eventB.id)).toBe(false);
    });

    it('Tenant Suspension Attack: Suspended Tenant key is atomically invalidated', async () => {
      const suspTenant = await tenantRepo.create({ name: 'Suspended Tenant Co', status: 'active' });
      const suspKey = await apiKeyRepo.createKey(suspTenant.id, {
        name: 'Susp Key',
        keyPrefix: 'tik_susp_test',
        keyHash: 'hash_susp_tenant_atomic_check_123',
      });
      expect(suspKey.id).toBeDefined();

      // Valid initially
      expect((await apiKeyRepo.validateKey('hash_susp_tenant_atomic_check_123')).valid).toBe(true);

      // Suspend tenant
      await tenantRepo.updateStatus(suspTenant.id, 'suspended');

      // Validation must immediately fail with TENANT_INACTIVE
      const suspResult = await apiKeyRepo.validateKey('hash_susp_tenant_atomic_check_123');
      expect(suspResult.valid).toBe(false);
      expect(suspResult.reason).toBe('TENANT_INACTIVE');

      // Clean up
      await prisma.tenant.delete({ where: { id: suspTenant.id } });
    });

    it('Concurrency Stress: Parallel simultaneous session creation for same creator across 5 isolated tenants succeeds', async () => {
      // Create 5 temporary tenants
      const tenants = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          tenantRepo.create({ name: `Concurrent Tenant ${i}`, status: 'active' })
        )
      );

      const targetHandle = '@concurrent_superstar';

      // Simultaneously dispatch session creation for the same handle in all 5 tenants
      const creationPromises = tenants.map((t) =>
        sessionRepo.create(t.id, { creatorUsername: targetHandle, roomId: `room_${t.id.slice(0, 8)}` })
      );

      const createdSessions = await Promise.all(creationPromises);

      // Verify all 5 succeeded with unique IDs and proper tenant IDs
      expect(createdSessions.length).toBe(5);
      const uniqueSessionIds = new Set(createdSessions.map((s) => s.id));
      expect(uniqueSessionIds.size).toBe(5);

      for (let i = 0; i < 5; i++) {
        expect(createdSessions[i].tenantId).toBe(tenants[i].id);
        expect(createdSessions[i].creatorUsername).toBe('concurrent_superstar');
        expect(createdSessions[i].status).toBe('queued');
      }

      // Cleanup 5 temporary tenants
      await Promise.all(tenants.map((t) => prisma.tenant.delete({ where: { id: t.id } })));
    });

    it('Cascade Deletion Isolation: Deleting Tenant A completely wipes Tenant A data while Tenant B remains untouched', async () => {
      // Create disposable Tenant C and D
      const tenantC = await tenantRepo.create({ name: 'Disposable Tenant C', status: 'active' });
      const tenantD = await tenantRepo.create({ name: 'Persistent Tenant D', status: 'active' });

      const sessionC = await sessionRepo.create(tenantC.id, { creatorUsername: 'streamer_c' });
      const sessionD = await sessionRepo.create(tenantD.id, { creatorUsername: 'streamer_d' });

      const eventC = await eventRepo.createEvent(tenantC.id, {
        sessionId: sessionC.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'To be deleted' },
      });

      const eventD = await eventRepo.createEvent(tenantD.id, {
        sessionId: sessionD.id,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'To be preserved' },
      });

      // Delete Tenant C
      await prisma.tenant.delete({ where: { id: tenantC.id } });

      // Verify Tenant C resources were cascade deleted
      expect(await prisma.liveSession.findUnique({ where: { id: sessionC.id } })).toBeNull();
      expect(await prisma.event.findUnique({ where: { id: eventC.id } })).toBeNull();

      // Verify Tenant D resources remain completely intact
      const preservedSessionD = await sessionRepo.findById(tenantD.id, sessionD.id);
      expect(preservedSessionD).not.toBeNull();
      expect(preservedSessionD?.id).toBe(sessionD.id);

      const preservedEventD = await eventRepo.findById(tenantD.id, eventD.id);
      expect(preservedEventD).not.toBeNull();
      expect(preservedEventD?.id).toBe(eventD.id);

      // Clean up Tenant D
      await prisma.tenant.delete({ where: { id: tenantD.id } });
    });
  });
});

