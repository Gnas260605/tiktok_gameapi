import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';

describe('Live Sessions REST API', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantAlphaId = 'a2222222-2222-4222-8222-222222222222';
  const tenantBetaId = 'b2222222-2222-4222-8222-222222222222';
  const apiKeyAlpha = 'tik_live_session_test_key_alpha';
  const apiKeyBeta = 'tik_live_session_test_key_beta';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    // Create Tenants
    await prisma.tenant.upsert({
      where: { id: tenantAlphaId },
      update: { status: 'active', name: 'Alpha Streamers' },
      create: { id: tenantAlphaId, status: 'active', name: 'Alpha Streamers' },
    });
    await prisma.tenant.upsert({
      where: { id: tenantBetaId },
      update: { status: 'active', name: 'Beta Streamers' },
      create: { id: tenantBetaId, status: 'active', name: 'Beta Streamers' },
    });

    // Create API Keys
    const prefixAlpha = 'tik_live_sess_a';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixAlpha } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Alpha Key',
        keyPrefix: prefixAlpha,
        keyHash: AuthService.hashKey(apiKeyAlpha),
        status: 'active',
      },
    });

    const prefixBeta = 'tik_live_sess_b';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixBeta } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantBetaId,
        name: 'Beta Key',
        keyPrefix: prefixBeta,
        keyHash: AuthService.hashKey(apiKeyBeta),
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.liveSession.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.apiKey.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAlphaId, tenantBetaId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  let createdSessionId: string;

  it('POST /api/v1/live/sessions creates a session and returns 202 Accepted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
      payload: {
        creatorUsername: 'streamer_alice',
        mode: 'mock',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.creatorUsername).toBe('streamer_alice');
    expect(body.data.status).toBe('queued');

    createdSessionId = body.data.id;
  });

  it('POST /api/v1/live/sessions returns 409 Conflict if active session exists for creator', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
      payload: {
        creatorUsername: 'streamer_alice',
        mode: 'mock',
      },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('POST /api/v1/live/sessions closes an active session orphaned by a restart', async () => {
    // A row left "connected" by a previous process has no in-memory connector here
    const orphan = await prisma.liveSession.create({
      data: {
        tenantId: tenantAlphaId,
        platform: 'tiktok',
        creatorUsername: 'streamer_orphan',
        status: 'connected',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
      payload: {
        creatorUsername: 'streamer_orphan',
        mode: 'mock',
      },
    });

    expect(response.statusCode).toBe(202);
    const closed = await prisma.liveSession.findUnique({ where: { id: orphan.id } });
    expect(closed?.status).toBe('disconnected');
    expect(closed?.disconnectReason).toBe('ORPHANED_BY_RESTART');
  });

  it('GET /api/v1/live/sessions returns paginated session list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.meta).toBeDefined();
  });

  it('GET /api/v1/live/sessions/:sessionId returns session details', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/live/sessions/${createdSessionId}`,
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(createdSessionId);
  });

  it('GET /api/v1/live/sessions/:sessionId returns 404 for other tenant (tenant isolation)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/live/sessions/${createdSessionId}`,
      headers: {
        authorization: `Bearer ${apiKeyBeta}`, // Beta tries to read Alpha's session
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('DELETE /api/v1/live/sessions/:sessionId disconnects session and returns 202', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/live/sessions/${createdSessionId}`,
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ended');
    expect(body.data.endedAt).toBeDefined();
  });
});
