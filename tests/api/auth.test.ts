import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';

describe('Auth Middleware & API Key Validation', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantAlphaId = 'a1111111-1111-4111-8111-111111111111';
  const validKey = 'tik_live_auth_test_key_alpha_12345';
  const revokedKey = 'tik_live_auth_test_key_revoked_67890';
  const expiredKey = 'tik_live_auth_test_key_expired_54321';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    // Setup tenant and test API keys
    await prisma.tenant.upsert({
      where: { id: tenantAlphaId },
      update: { status: 'active', name: 'Auth Test Tenant' },
      create: { id: tenantAlphaId, status: 'active', name: 'Auth Test Tenant' },
    });

    // 1. Active Key
    const keyPrefixValid = 'tik_live_auth_v1';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: keyPrefixValid } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Valid Key',
        keyPrefix: keyPrefixValid,
        keyHash: AuthService.hashKey(validKey),
        status: 'active',
        revoked: false,
      },
    });

    // 2. Revoked Key
    const keyPrefixRevoked = 'tik_live_auth_r1';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: keyPrefixRevoked } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Revoked Key',
        keyPrefix: keyPrefixRevoked,
        keyHash: AuthService.hashKey(revokedKey),
        status: 'revoked',
        revoked: true,
        revokedAt: new Date(),
      },
    });

    // 3. Expired Key
    const keyPrefixExpired = 'tik_live_auth_e1';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: keyPrefixExpired } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Expired Key',
        keyPrefix: keyPrefixExpired,
        keyHash: AuthService.hashKey(expiredKey),
        status: 'expired',
        expiresAt: new Date(Date.now() - 10000),
      },
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { tenantId: tenantAlphaId } });
    await prisma.tenant.deleteMany({ where: { id: tenantAlphaId } });
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects requests without API Key with 401 UNAUTHORIZED', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with an invalid API Key with 401 UNAUTHORIZED', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: 'Bearer tik_live_completely_bogus_key',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts requests with valid API key via Authorization Bearer header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${validKey}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('accepts requests with valid API key via X-API-Key header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        'x-api-key': validKey,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
  });

  it('rejects revoked API key with 403 FORBIDDEN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${revokedKey}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects expired API key with 403 FORBIDDEN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${expiredKey}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
