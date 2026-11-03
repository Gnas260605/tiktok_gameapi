import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';

describe('API Keys Management REST API', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantAlphaId = 'a5555555-5555-4555-8555-555555555555';
  const rootApiKeyAlpha = 'tik_live_root_test_key_alpha';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    // Create Tenant
    await prisma.tenant.upsert({
      where: { id: tenantAlphaId },
      update: { status: 'active', name: 'Alpha API Key Tenant' },
      create: { id: tenantAlphaId, status: 'active', name: 'Alpha API Key Tenant' },
    });

    // Create root API Key
    const prefixAlpha = 'tik_live_root_a';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixAlpha } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Alpha Root Key',
        keyPrefix: prefixAlpha,
        keyHash: AuthService.hashKey(rootApiKeyAlpha),
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { tenantId: tenantAlphaId } });
    await prisma.tenant.deleteMany({ where: { id: tenantAlphaId } });
    await app.close();
    await prisma.$disconnect();
  });

  let createdKeyId: string;
  let createdPlaintextKey: string;

  it('POST /api/v1/api-keys creates a new API key and returns plaintext key once', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: {
        authorization: `Bearer ${rootApiKeyAlpha}`,
      },
      payload: {
        name: 'Automation Bot Key',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe('Automation Bot Key');
    expect(body.data.key).toMatch(/^tik_live_[0-9a-f]{48}$/);
    expect(body.data.keyPrefix).toBe('tik_live');

    createdKeyId = body.data.id;
    createdPlaintextKey = body.data.key;
  });

  it('New API Key can immediately authenticate API requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${createdPlaintextKey}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
  });

  it('GET /api/v1/api-keys lists keys metadata without leaking secrets', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: {
        authorization: `Bearer ${rootApiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(2);

    // Verify secrets are NOT exposed
    for (const keyMeta of body.data) {
      expect(keyMeta.key).toBeUndefined();
      expect(keyMeta.keyHash).toBeUndefined();
      expect(keyMeta.id).toBeDefined();
      expect(keyMeta.name).toBeDefined();
      expect(keyMeta.keyPrefix).toBeDefined();
      expect(keyMeta.status).toBeDefined();
    }
  });

  it('DELETE /api/v1/api-keys/:keyId revokes the key with 204 No Content', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${createdKeyId}`,
      headers: {
        authorization: `Bearer ${rootApiKeyAlpha}`,
      },
    });

    expect(response.statusCode).toBe(204);
  });

  it('Revoked key is immediately rejected on subsequent requests with 403', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: {
        authorization: `Bearer ${createdPlaintextKey}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
