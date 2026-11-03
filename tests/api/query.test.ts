import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';

describe('Users and Events Query REST API', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantAlphaId = 'a3333333-3333-4333-8333-333333333333';
  const tenantBetaId = 'b3333333-3333-4333-8333-333333333333';
  const apiKeyAlpha = 'tik_live_query_test_key_alpha';
  const apiKeyBeta = 'tik_live_query_test_key_beta';

  let sessionIdAlpha: string;
  let userIdAlpha: string;
  let eventIdAlpha: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    // Create Tenants
    await prisma.tenant.upsert({
      where: { id: tenantAlphaId },
      update: { status: 'active', name: 'Alpha Query Tenant' },
      create: { id: tenantAlphaId, status: 'active', name: 'Alpha Query Tenant' },
    });
    await prisma.tenant.upsert({
      where: { id: tenantBetaId },
      update: { status: 'active', name: 'Beta Query Tenant' },
      create: { id: tenantBetaId, status: 'active', name: 'Beta Query Tenant' },
    });

    // Create API Keys
    const prefixAlpha = 'tik_live_qry_a';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixAlpha } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Alpha Query Key',
        keyPrefix: prefixAlpha,
        keyHash: AuthService.hashKey(apiKeyAlpha),
        status: 'active',
      },
    });

    const prefixBeta = 'tik_live_qry_b';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixBeta } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantBetaId,
        name: 'Beta Query Key',
        keyPrefix: prefixBeta,
        keyHash: AuthService.hashKey(apiKeyBeta),
        status: 'active',
      },
    });

    // Seed session for Alpha
    const session = await prisma.liveSession.create({
      data: {
        tenantId: tenantAlphaId,
        platform: 'tiktok',
        creatorUsername: 'query_streamer',
        status: 'connected',
      },
    });
    sessionIdAlpha = session.id;

    // Seed user for Alpha
    const user = await prisma.user.create({
      data: {
        tenantId: tenantAlphaId,
        platform: 'tiktok',
        platformUserId: 'query_user_1001',
        uniqueId: 'wonder_woman',
        nickname: 'Princess Diana',
        identityQuality: 'platform_id',
      },
    });
    userIdAlpha = user.id;

    // Seed events for Alpha
    const event = await prisma.event.create({
      data: {
        tenantId: tenantAlphaId,
        sessionId: sessionIdAlpha,
        userId: userIdAlpha,
        eventType: 'chat',
        occurredAt: new Date(),
        data: { text: 'Query Test Chat Message' },
      },
    });
    eventIdAlpha = event.id;
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.liveSession.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.apiKey.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAlphaId, tenantBetaId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /api/v1/users returns observed users list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((u: any) => u.id === userIdAlpha)).toBe(true);
  });

  it('GET /api/v1/users with search query returns matching users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users?search=wonder',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].uniqueId).toBe('wonder_woman');
  });

  it('GET /api/v1/users/:userId returns user profile', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${userIdAlpha}`,
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(userIdAlpha);
    expect(body.data.uniqueId).toBe('wonder_woman');
  });

  it('GET /api/v1/users/:userId returns 404 for other tenant (tenant isolation)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${userIdAlpha}`,
      headers: {
        authorization: `Bearer ${apiKeyBeta}`, // Beta tries to query Alpha's user
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/v1/users/:userId/events returns events for user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${userIdAlpha}/events`,
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/events returns event list and supports eventType filtering', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events?eventType=chat',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((e: any) => e.eventId === eventIdAlpha)).toBe(true);
  });

  it('GET /api/v1/events/:eventId returns event detail', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventIdAlpha}`,
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.eventId).toBe(eventIdAlpha);
    expect(body.data.data.text).toBe('Query Test Chat Message');
  });

  it('GET /api/v1/events/:eventId returns 404 for other tenant (tenant isolation)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventIdAlpha}`,
      headers: {
        authorization: `Bearer ${apiKeyBeta}`, // Beta tries to query Alpha's event
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
