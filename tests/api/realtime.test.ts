import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';

describe('Realtime Tickets REST API', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantAlphaId = 'a4444444-4444-4444-8444-444444444444';
  const tenantBetaId = 'b4444444-4444-4444-8444-444444444444';
  const apiKeyAlpha = 'tik_live_realtime_test_key_alpha';
  const apiKeyBeta = 'tik_live_realtime_test_key_beta';

  let sessionIdAlpha: string;
  let sessionIdBeta: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    // Create Tenants
    await prisma.tenant.upsert({
      where: { id: tenantAlphaId },
      update: { status: 'active', name: 'Alpha Realtime Tenant' },
      create: { id: tenantAlphaId, status: 'active', name: 'Alpha Realtime Tenant' },
    });
    await prisma.tenant.upsert({
      where: { id: tenantBetaId },
      update: { status: 'active', name: 'Beta Realtime Tenant' },
      create: { id: tenantBetaId, status: 'active', name: 'Beta Realtime Tenant' },
    });

    // Create API Keys
    const prefixAlpha = 'tik_live_rt_a';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixAlpha } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Alpha RT Key',
        keyPrefix: prefixAlpha,
        keyHash: AuthService.hashKey(apiKeyAlpha),
        status: 'active',
      },
    });

    const prefixBeta = 'tik_live_rt_b';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixBeta } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantBetaId,
        name: 'Beta RT Key',
        keyPrefix: prefixBeta,
        keyHash: AuthService.hashKey(apiKeyBeta),
        status: 'active',
      },
    });

    // Sessions
    const sessAlpha = await prisma.liveSession.create({
      data: {
        tenantId: tenantAlphaId,
        platform: 'tiktok',
        creatorUsername: 'streamer_alpha_rt',
      },
    });
    sessionIdAlpha = sessAlpha.id;

    const sessBeta = await prisma.liveSession.create({
      data: {
        tenantId: tenantBetaId,
        platform: 'tiktok',
        creatorUsername: 'streamer_beta_rt',
      },
    });
    sessionIdBeta = sessBeta.id;
  });

  afterAll(async () => {
    await prisma.liveSession.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.apiKey.deleteMany({ where: { tenantId: { in: [tenantAlphaId, tenantBetaId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAlphaId, tenantBetaId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /api/v1/realtime/tickets issues short-lived ticket for authorized sessions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/tickets',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
      payload: {
        sessionIds: [sessionIdAlpha],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.ticket).toMatch(/^tkt_[0-9a-f]{48}$/);
    expect(body.data.expiresAt).toBeDefined();
    expect(body.data.websocketUrl).toBeDefined();
  });

  it('POST /api/v1/realtime/tickets returns 400 if sessionIds is missing or empty', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/tickets',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`,
      },
      payload: {
        sessionIds: [],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('POST /api/v1/realtime/tickets returns 403 if sessionId belongs to another tenant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/tickets',
      headers: {
        authorization: `Bearer ${apiKeyAlpha}`, // Alpha requests ticket for Beta's session
      },
      payload: {
        sessionIds: [sessionIdBeta],
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SESSION_FORBIDDEN');
  });
});
