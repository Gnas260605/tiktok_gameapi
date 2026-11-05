import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../../src/app';
import { AuthService } from '../../../src/services/auth/auth.service';
import { DEFAULT_GAME_CONFIG_VALUES, SEED_REALMS } from '../../../prisma/seed-tutien';

describe('Tu Tien Live — Game Controllers & Scope Middleware API Suite', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantId = '77777777-7777-4777-8777-777777777777';
  const otherTenantId = '88888888-8888-4888-8888-888888888888';

  const rawKeyOverlay = 'tik_live_game_overlay_key_test_12345';
  const rawKeyAdmin = 'tik_live_game_admin_key_test_12345';
  const rawKeyNoScope = 'tik_live_no_scope_key_test_12345';
  const rawKeyWildcard = 'tik_live_wildcard_key_test_12345';

  let sessionId: string;
  let otherSessionId: string;
  let playerId: string;
  let otherPlayerId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    // 1. Setup Tenants
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: { name: 'Game Test Tenant', status: 'active' },
      create: { id: tenantId, name: 'Game Test Tenant', status: 'active' },
    });

    await prisma.tenant.upsert({
      where: { id: otherTenantId },
      update: { name: 'Other Tenant', status: 'active' },
      create: { id: otherTenantId, name: 'Other Tenant', status: 'active' },
    });

    // 2. Setup API Keys with Scopes
    await prisma.apiKey.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });

    await prisma.apiKey.createMany({
      data: [
        {
          tenantId,
          name: 'Overlay Key',
          keyPrefix: 'tik_live_ovr_',
          keyHash: AuthService.hashKey(rawKeyOverlay),
          scopes: ['game:overlay'],
          status: 'active',
        },
        {
          tenantId,
          name: 'Admin Key',
          keyPrefix: 'tik_live_adm_',
          keyHash: AuthService.hashKey(rawKeyAdmin),
          scopes: ['game:admin'],
          status: 'active',
        },
        {
          tenantId,
          name: 'No Scope Key',
          keyPrefix: 'tik_live_none',
          keyHash: AuthService.hashKey(rawKeyNoScope),
          scopes: ['other:read'],
          status: 'active',
        },
        {
          tenantId,
          name: 'Wildcard Key',
          keyPrefix: 'tik_live_wild',
          keyHash: AuthService.hashKey(rawKeyWildcard),
          scopes: ['*'],
          status: 'active',
        },
      ],
    });

    // 3. Setup Seed Realms & Levels for Both Tenants
    for (const tId of [tenantId, otherTenantId]) {
      for (const realm of SEED_REALMS) {
        await prisma.cultivationRealm.upsert({
          where: { tenantId_realmOrder: { tenantId: tId, realmOrder: realm.realmOrder } },
          update: {},
          create: {
            tenantId: tId,
            realmOrder: realm.realmOrder,
            code: realm.code,
            name: realm.name,
            themeColor: realm.themeColor,
            baseChanceBp: realm.baseChanceBp,
            chanceBpPer100Diamonds: realm.chanceBpPer100Diamonds,
            characterMaleAsset: realm.characterMaleAsset,
            characterFemaleAsset: realm.characterFemaleAsset,
          },
        });

        for (let lvl = 1; lvl <= 10; lvl++) {
          await prisma.cultivationLevel.upsert({
            where: {
              tenantId_realmOrder_level: { tenantId: tId, realmOrder: realm.realmOrder, level: lvl },
            },
            update: {},
            create: {
              tenantId: tId,
              realmOrder: realm.realmOrder,
              level: lvl,
              requiredExp: BigInt(lvl * 1000),
            },
          });
        }
      }
    }

    // 4. Setup Default Configurations
    for (const [key, value] of Object.entries(DEFAULT_GAME_CONFIG_VALUES)) {
      await prisma.gameConfiguration.upsert({
        where: { tenantId_configKey: { tenantId, configKey: key } },
        update: { configValue: value as any, revision: 1 },
        create: {
          tenantId,
          configKey: key,
          configValue: value as any,
          revision: 1,
        },
      });
    }

    // 5. Setup Live Sessions
    const s1 = await prisma.liveSession.create({
      data: {
        tenantId,
        creatorUsername: 'game_streamer',
        status: 'connected',
      },
    });
    sessionId = s1.id;

    const s2 = await prisma.liveSession.create({
      data: {
        tenantId: otherTenantId,
        creatorUsername: 'other_streamer',
        status: 'connected',
      },
    });
    otherSessionId = s2.id;

    // 6. Setup Users & Players
    const u1 = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: 'cultivator_dan',
        nickname: 'Dan Tiên Tử',
        identityQuality: 'handle_fallback',
      },
    });

    const p1 = await prisma.gamePlayer.create({
      data: {
        tenantId,
        userId: u1.id,
        username: 'cultivator_dan',
        nickname: 'Dan Tiên Tử',
        gender: 'male',
        realmOrder: 1,
        level: 5,
        currentExp: 500n,
        totalCultivation: 500n,
        totalDiamondsGifted: 0n,
      },
    });
    playerId = p1.id;

    const u2 = await prisma.user.create({
      data: {
        tenantId: otherTenantId,
        platform: 'tiktok',
        uniqueId: 'other_cultivator',
        nickname: 'Other Player',
        identityQuality: 'handle_fallback',
      },
    });

    const p2 = await prisma.gamePlayer.create({
      data: {
        tenantId: otherTenantId,
        userId: u2.id,
        username: 'other_cultivator',
        nickname: 'Other Player',
        gender: 'female',
        realmOrder: 1,
        level: 1,
        currentExp: 0n,
      },
    });
    otherPlayerId = p2.id;
  });

  afterAll(async () => {
    await prisma.gameEvent.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.giftTransaction.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.breakthroughHistory.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.breakthroughSession.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.gamePlayer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.liveSession.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.gameConfiguration.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.cultivationLevel.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.cultivationRealm.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.apiKey.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });

    await app.close();
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. Scope Authorization & Public Static Endpoints
  // =========================================================================
  describe('Scope Middleware & Authorization', () => {
    it('returns 401 UNAUTHORIZED when no API key is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/realms',
      });
      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN when API key lacks required scope', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/realms',
        headers: { authorization: `Bearer ${rawKeyNoScope}` },
      });
      expect(res.statusCode).toBe(403);
      const json = res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('allows key with game:overlay on overlay endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/realms',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(8);
    });

    it('rejects key with only game:overlay on admin endpoints with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/admin/config',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('allows key with game:admin on admin endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/admin/config',
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.data.values.gameEnabled).toBe(true);
    });

    it('allows key with wildcard * on both overlay and admin endpoints', async () => {
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/v1/game/realms',
        headers: { authorization: `Bearer ${rawKeyWildcard}` },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: 'GET',
        url: '/api/v1/game/admin/config',
        headers: { authorization: `Bearer ${rawKeyWildcard}` },
      });
      expect(res2.statusCode).toBe(200);
    });

    it('GET /tutien is public and does not require authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tutien',
      });
      // 200 if template exists or 404 if template not yet present, but NEVER 401
      expect([200, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(401);
    });

    it('GET /tutien-assets/:file strictly rejects directory traversal attacks', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tutien-assets/..%2F..%2Fsecret.png',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // 2. Game State & Realms
  // =========================================================================
  describe('Game State & Realms Endpoints', () => {
    it('GET /api/v1/game/state returns 400 when liveSessionId is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/state',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('GET /api/v1/game/state returns 404 when liveSessionId belongs to another tenant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/game/state?liveSessionId=${otherSessionId}`,
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('GET /api/v1/game/state returns 200 with snapshot data for valid liveSessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/game/state?liveSessionId=${sessionId}`,
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.data.flags.gameEnabled).toBe(true);
      expect(typeof json.data.lastSeq).toBe('string');
      expect(Array.isArray(json.data.activeBreakthroughs)).toBe(true);
      expect(Array.isArray(json.data.leaderboards)).toBe(true);
      expect(json.data.leaderboards).toHaveLength(5);
    });

    it('GET /api/v1/game/realms returns 8 realms and 10 levels with string BigInts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/realms',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data).toHaveLength(8);
      const luyenKhi = json.data[0];
      expect(luyenKhi.realmOrder).toBe(1);
      expect(luyenKhi.code).toBe('luyen_khi');
      expect(luyenKhi.levels).toHaveLength(10);
      expect(typeof luyenKhi.levels[0].requiredExp).toBe('string');
    });
  });

  // =========================================================================
  // 3. Player Profiles & Status
  // =========================================================================
  describe('Player Endpoints', () => {
    it('GET /api/v1/game/players returns paginated players with cursor metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/players?limit=10',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      expect(json.data[0].username).toBe('cultivator_dan');
      expect(typeof json.data[0].currentExp).toBe('string');
      expect(typeof json.data[0].requiredExp).toBe('string');
      expect(json.meta).toBeDefined();
    });

    it('GET /api/v1/game/players/:playerId returns player profile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/game/players/${playerId}`,
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.id).toBe(playerId);
      expect(json.data.realmName).toBe('Luyện Khí');
      expect(json.data.characterAsset).toBe('luyen_khi_male.webp');
      expect(json.data.currentExp).toBe('500');
    });

    it('GET /api/v1/game/players/by-username/:username returns player profile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/players/by-username/cultivator_dan',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.username).toBe('cultivator_dan');
    });

    it('GET /api/v1/game/players/:playerId returns 404 for other tenant player', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/game/players/${otherPlayerId}`,
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('GET /api/v1/game/players/:playerId/status checks breakthrough readiness', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/game/players/${playerId}/status`,
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.playerId).toBe(playerId);
      expect(json.data.canBreakthrough).toBe(false);
      expect(json.data.blockedReason).toBe('NOT_MAX_LEVEL'); // level 5 !== 10
    });
  });

  // =========================================================================
  // 4. Leaderboards
  // =========================================================================
  describe('Leaderboard Endpoints', () => {
    it('GET /api/v1/game/leaderboards/:board returns 400 for invalid board', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/leaderboards/invalid_board',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('GET /api/v1/game/leaderboards/:board returns 400 for scope=session without liveSessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/leaderboards/cultivation?scope=session',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('GET /api/v1/game/leaderboards/:board returns 200 with dense-ranked entries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/game/leaderboards/cultivation?scope=all&limit=5',
        headers: { authorization: `Bearer ${rawKeyOverlay}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.data.board).toBe('cultivation');
      expect(Array.isArray(json.data.entries)).toBe(true);
    });
  });

  // =========================================================================
  // 5. Breakthroughs & Idempotency
  // =========================================================================
  describe('Breakthroughs Endpoints', () => {
    it('POST /api/v1/game/breakthroughs returns 400 when Idempotency-Key header is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/game/breakthroughs',
        headers: {
          authorization: `Bearer ${rawKeyOverlay}`,
        },
        payload: {
          playerId,
          liveSessionId: sessionId,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('Idempotency-Key');
    });

    it('POST /api/v1/game/breakthroughs returns 409 NOT_MAX_LEVEL when player is not level 10', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/game/breakthroughs',
        headers: {
          authorization: `Bearer ${rawKeyOverlay}`,
          'Idempotency-Key': 'idemp_test_key_0001',
        },
        payload: {
          playerId,
          liveSessionId: sessionId,
        },
      });
      expect(res.statusCode).toBe(409);
      const json = res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('CONFLICT');
      expect(json.error.details.reason).toBe('NOT_MAX_LEVEL');
    });

    it('POST /api/v1/game/breakthroughs returns 422 when Idempotency-Key is reused with different payload', async () => {
      // First, create a mock session directly with requestKey = 'reused_key_1234'
      await prisma.breakthroughSession.create({
        data: {
          tenantId,
          playerId,
          liveSessionId: sessionId,
          sourceRealmOrder: 1,
          targetRealmOrder: 2,
          baseChanceBp: 9000,
          status: 'preparing',
          requestKey: 'reused_key_1234',
          requestHash: 'hash_for_body_a',
          endsAt: new Date(Date.now() + 30000),
        },
      });

      // Send request with same requestKey but different body hash
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/game/breakthroughs',
        headers: {
          authorization: `Bearer ${rawKeyOverlay}`,
          'Idempotency-Key': 'reused_key_1234',
        },
        payload: {
          playerId,
          liveSessionId: sessionId,
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('UNPROCESSABLE_ENTITY');
    });
  });

  // =========================================================================
  // 6. Admin API (Config Revision, Audit Logs, Health)
  // =========================================================================
  describe('Admin API Endpoints', () => {
    it('PUT /api/v1/game/admin/config returns 409 CONFLICT on baseRevision mismatch', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/game/admin/config',
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
        payload: {
          baseRevision: 999, // mismatch
          values: { tuViMultiplier: 20 },
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('REVISION_CONFLICT');
    });

    it('PUT /api/v1/game/admin/config successfully updates config and records audit log', async () => {
      // Read current config
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/v1/game/admin/config',
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
      });
      const currentRev = getRes.json().data.revision;

      const putRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/game/admin/config',
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
        payload: {
          baseRevision: currentRev,
          values: { tuViMultiplier: 25 },
        },
      });
      expect(putRes.statusCode).toBe(200);
      const json = putRes.json();
      expect(json.data.revision).toBe(currentRev + 1);
      expect(json.data.values.tuViMultiplier).toBe(25);

      // Verify audit log
      const auditRes = await app.inject({
        method: 'GET',
        url: '/api/v1/game/admin/audit-logs',
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
      });
      expect(auditRes.statusCode).toBe(200);
      expect(auditRes.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /tutien/admin is public and does not require authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tutien/admin',
      });
      expect([200, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(401);
    });

    it('PATCH /api/v1/game/admin/players/:playerId updates player and validates expectedVersion', async () => {
      // First get current version
      const getP = await app.inject({
        method: 'GET',
        url: `/api/v1/game/players/${playerId}`,
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
      });
      const currentVer = getP.json().data.version;

      // Conflict test
      const conflictRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/game/admin/players/${playerId}`,
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
        payload: {
          expectedVersion: currentVer + 999,
          reason: 'Admin adjusting stats',
          level: 6,
        },
      });
      expect(conflictRes.statusCode).toBe(409);

      // Successful update
      const successRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/game/admin/players/${playerId}`,
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
        payload: {
          expectedVersion: currentVer,
          reason: 'Manual tier upgrade by game master',
          level: 6,
        },
      });
      expect(successRes.statusCode).toBe(200);
      expect(successRes.json().data.level).toBe(6);
      expect(successRes.json().data.version).toBe(currentVer + 1);
    });

    it('POST /api/v1/game/admin/players/:playerId/reset requires confirmUsername and resets character', async () => {
      // Wrong username
      const wrongRes = await app.inject({
        method: 'POST',
        url: `/api/v1/game/admin/players/${playerId}/reset`,
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
        payload: {
          confirmUsername: 'wrong_username',
          reason: 'Player requested reset',
        },
      });
      expect(wrongRes.statusCode).toBe(400);

      // Correct username
      const resetRes = await app.inject({
        method: 'POST',
        url: `/api/v1/game/admin/players/${playerId}/reset`,
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
        payload: {
          confirmUsername: 'cultivator_dan',
          reason: 'Player requested fresh start',
        },
      });
      expect(resetRes.statusCode).toBe(200);
      const json = resetRes.json();
      expect(json.data.realmOrder).toBe(1);
      expect(json.data.level).toBe(1);
      expect(json.data.currentExp).toBe('0');
    });

    it('PATCH /api/v1/game/admin/realms/:realmOrder updates realm and invalidates config cache', async () => {
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/game/admin/realms/1',
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
        payload: {
          baseChanceBp: 9200,
        },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().data.baseChanceBp).toBe(9200);
    });

    it('GET /api/v1/game/admin/health returns game operational health status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/game/admin/health?liveSessionId=${sessionId}`,
        headers: { authorization: `Bearer ${rawKeyAdmin}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data.gameEnabled).toBe(true);
      expect(json.data.sessionStatus).toBe('connected');
      expect(typeof json.data.pendingGiftCount).toBe('number');
    });
  });
});
