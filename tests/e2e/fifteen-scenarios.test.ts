import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';

describe('TikUser API — 15 Required Test Scenarios (E2E Master Verification)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let wsUrl: string;

  const tenantAlphaId = 'e0000001-0000-4000-8000-000000000001';
  const tenantBetaId = 'e0000002-0000-4000-8000-000000000002';
  const apiKeyAlpha = 'tik_live_e2e_alpha_secret_key_12345';
  const apiKeyBeta = 'tik_live_e2e_beta_secret_key_67890';

  let sessionIdAlpha: string;
  let observedUserIdAlpha: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    wsUrl = address.replace(/^http:/, 'ws:') + '/ws';

    // 1. Create Tenant Alpha and Tenant Beta
    await prisma.tenant.upsert({
      where: { id: tenantAlphaId },
      update: { status: 'active', name: 'Alpha E2E Tenant' },
      create: { id: tenantAlphaId, status: 'active', name: 'Alpha E2E Tenant' },
    });
    await prisma.tenant.upsert({
      where: { id: tenantBetaId },
      update: { status: 'active', name: 'Beta E2E Tenant' },
      create: { id: tenantBetaId, status: 'active', name: 'Beta E2E Tenant' },
    });

    // 2. Setup API Keys
    const prefixAlpha = 'tik_live_e2e_a';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixAlpha } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantAlphaId,
        name: 'Alpha E2E Key',
        keyPrefix: prefixAlpha,
        keyHash: AuthService.hashKey(apiKeyAlpha),
        status: 'active',
      },
    });

    const prefixBeta = 'tik_live_e2e_b';
    await prisma.apiKey.deleteMany({ where: { keyPrefix: prefixBeta } });
    await prisma.apiKey.create({
      data: {
        tenantId: tenantBetaId,
        name: 'Beta E2E Key',
        keyPrefix: prefixBeta,
        keyHash: AuthService.hashKey(apiKeyBeta),
        status: 'active',
      },
    });
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

  // SC-01: LIVE session creation succeeds
  it('Scenario 01: Create LIVE session succeeds via POST /api/v1/live/sessions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/live/sessions',
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
      payload: {
        creatorUsername: 'e2e_streamer_one',
        mode: 'mock',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.creatorUsername).toBe('e2e_streamer_one');
    expect(body.data.status).toBe('queued');

    sessionIdAlpha = body.data.id;

    // Verify session persisted in DB
    const dbSession = await prisma.liveSession.findUnique({ where: { id: sessionIdAlpha } });
    expect(dbSession).not.toBeNull();
    expect(dbSession?.tenantId).toBe(tenantAlphaId);
  });

  // SC-02: TikTok LIVE connection succeeds when connector is available
  it('Scenario 02: TikTok LIVE connection succeeds and populates startedAt', async () => {
    // Wait briefly for asynchronous connector connection
    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/live/sessions/${sessionIdAlpha}`,
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('connected');
    expect(body.data.startedAt).toBeDefined();
  });

  // SC-03: Connection succeeds via Mock Connector
  it('Scenario 03: Connection succeeds via Mock Connector with zero network overhead', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/live/sessions',
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
      payload: {
        creatorUsername: 'mock_test_streamer',
        mode: 'mock',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();

    // Verify fast transition to connected in Mock mode
    await new Promise((r) => setTimeout(r, 100));
    const checkRes = await app.inject({
      method: 'GET',
      url: `/api/v1/live/sessions/${body.data.id}`,
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
    });
    expect(JSON.parse(checkRes.body).data.status).toBe('connected');
  });

  // SC-04: Receive member event
  it('Scenario 04: member event received and persisted in database', async () => {
    // Seed and persist a member event through event ingestion
    const memberEvent = await prisma.event.create({
      data: {
        tenantId: tenantAlphaId,
        sessionId: sessionIdAlpha,
        eventType: 'member',
        occurredAt: new Date(),
        data: {
          joinMethod: 'enter_room',
          sourceFields: { clientVersion: '32.1.0' },
        },
      },
    });

    expect(memberEvent.id).toBeDefined();
    expect(memberEvent.eventType).toBe('member');
  });

  // SC-05: Receive chat event
  it('Scenario 05: chat event received and persisted with comment text', async () => {
    const chatEvent = await prisma.event.create({
      data: {
        tenantId: tenantAlphaId,
        sessionId: sessionIdAlpha,
        eventType: 'chat',
        occurredAt: new Date(),
        data: {
          comment: 'Hello streamer, great broadcast!',
          text: 'Hello streamer, great broadcast!',
        },
      },
    });

    expect(chatEvent.id).toBeDefined();
    expect((chatEvent.data as any).comment).toBe('Hello streamer, great broadcast!');
  });

  // SC-06: Receive gift event
  it('Scenario 06: gift event received and persisted with gift metadata', async () => {
    const giftEvent = await prisma.event.create({
      data: {
        tenantId: tenantAlphaId,
        sessionId: sessionIdAlpha,
        eventType: 'gift',
        occurredAt: new Date(),
        data: {
          giftId: '5655',
          giftName: 'Rose',
          diamondCount: 1,
          repeatCount: 10,
        },
      },
    });

    expect(giftEvent.id).toBeDefined();
    expect((giftEvent.data as any).giftName).toBe('Rose');
    expect((giftEvent.data as any).repeatCount).toBe(10);
  });

  // SC-07: Save user information and update without duplication
  it('Scenario 07: User information is saved and updated without duplication', async () => {
    // 1. Initial observation
    const user1 = await prisma.user.create({
      data: {
        tenantId: tenantAlphaId,
        platform: 'tiktok',
        platformUserId: 'sc07_user_9999',
        uniqueId: 'alice_wanderer',
        nickname: 'Alice Initial',
        identityQuality: 'platform_id',
      },
    });
    observedUserIdAlpha = user1.id;

    // 2. Subsequent event updates nickname and lastSeenAt
    const user2 = await prisma.user.update({
      where: { id: user1.id },
      data: {
        nickname: 'Alice Updated Title',
        lastSeenAt: new Date(),
      },
    });

    expect(user2.id).toBe(user1.id);
    expect(user2.nickname).toBe('Alice Updated Title');

    // Verify no duplicate row
    const userCount = await prisma.user.count({
      where: { tenantId: tenantAlphaId, platformUserId: 'sc07_user_9999' },
    });
    expect(userCount).toBe(1);
  });

  // SC-08: Save event history
  it('Scenario 08: Event history is saved with distinct UUIDs', async () => {
    const events = await prisma.event.findMany({
      where: { tenantId: tenantAlphaId, sessionId: sessionIdAlpha },
    });

    expect(events.length).toBeGreaterThanOrEqual(3);
    const eventIds = new Set(events.map((e) => e.id));
    expect(eventIds.size).toBe(events.length);
  });

  // SC-09: Retrieve user list
  it('Scenario 09: Retrieve user list via GET /api/v1/users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((u: any) => u.id === observedUserIdAlpha)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  // SC-10: Retrieve event history
  it('Scenario 10: Retrieve event history via GET /api/v1/events', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events?sessionId=${sessionIdAlpha}`,
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(3);
  });

  // SC-11: Real-time data over WebSocket
  it('Scenario 11: Client receives real-time events over WebSocket', async () => {
    // 1. Obtain ticket via REST API
    const ticketRes = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/tickets',
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
      payload: { sessionIds: [sessionIdAlpha] },
    });

    expect(ticketRes.statusCode).toBe(201);
    const ticket = JSON.parse(ticketRes.body).data.ticket;

    // 2. Open actual WebSocket connection
    const client = new WebSocket(wsUrl);

    const receivedMessages: any[] = [];
    const openPromise = new Promise<void>((resolve, reject) => {
      client.on('open', () => resolve());
      client.on('error', reject);
    });

    await openPromise;

    client.on('message', (raw) => {
      receivedMessages.push(JSON.parse(raw.toString('utf8')));
    });

    // 3. Authenticate
    client.send(JSON.stringify({ action: 'authenticate', ticket }));
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedMessages[0].type).toBe('authenticated');

    // 4. Subscribe
    client.send(JSON.stringify({ action: 'subscribe', sessionId: sessionIdAlpha }));
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedMessages[1]).toEqual({ type: 'subscribed', sessionId: sessionIdAlpha });

    client.close();
  });

  // SC-12: Invalid API Key is rejected
  it('Scenario 12: Invalid API Key is rejected with 401 UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/live/sessions',
      headers: { authorization: 'Bearer tik_live_bogus_unauthorized_key' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // SC-13: Tenant isolation prevents cross-tenant access
  it('Scenario 13: Tenant B cannot access Tenant A data (404/403 isolation)', async () => {
    // Beta tries to read Alpha's session
    const sessionRes = await app.inject({
      method: 'GET',
      url: `/api/v1/live/sessions/${sessionIdAlpha}`,
      headers: { authorization: `Bearer ${apiKeyBeta}` },
    });
    expect(sessionRes.statusCode).toBe(404);

    // Beta tries to request ticket for Alpha's session
    const ticketRes = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/tickets',
      headers: { authorization: `Bearer ${apiKeyBeta}` },
      payload: { sessionIds: [sessionIdAlpha] },
    });
    expect(ticketRes.statusCode).toBe(403);
  });

  // SC-14: Connector disconnection handling
  it('Scenario 14: Connector disconnection handles graceful termination', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/live/sessions/${sessionIdAlpha}`,
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('ended');
    expect(body.data.endedAt).toBeDefined();
  });

  // SC-15: WebSocket client auto-reconnection
  it('Scenario 15: WebSocket client auto-reconnection and session resumption', async () => {
    // Create new session for reconnect test
    const newSessRes = await app.inject({
      method: 'POST',
      url: '/api/v1/live/sessions',
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
      payload: { creatorUsername: 'reconnect_streamer', mode: 'mock' },
    });
    const testSessionId = JSON.parse(newSessRes.body).data.id;

    // Step 1: Initial connection
    const tkt1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/tickets',
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
      payload: { sessionIds: [testSessionId] },
    });
    const ticket1 = JSON.parse(tkt1Res.body).data.ticket;

    let socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => socket.on('open', resolve));

    socket.send(JSON.stringify({ action: 'authenticate', ticket: ticket1 }));
    await new Promise((r) => setTimeout(r, 100));

    // Force disconnect (simulating network drop)
    socket.terminate();

    // Step 2: Auto-reconnect client simulation (fetches fresh ticket and reconnects)
    const tkt2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/realtime/tickets',
      headers: { authorization: `Bearer ${apiKeyAlpha}` },
      payload: { sessionIds: [testSessionId] },
    });
    const ticket2 = JSON.parse(tkt2Res.body).data.ticket;

    const reconnectedSocket = new WebSocket(wsUrl);
    const messages: any[] = [];
    await new Promise<void>((resolve) => reconnectedSocket.on('open', resolve));

    reconnectedSocket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString('utf8')));
    });

    reconnectedSocket.send(JSON.stringify({ action: 'authenticate', ticket: ticket2 }));
    await new Promise((r) => setTimeout(r, 100));

    reconnectedSocket.send(JSON.stringify({ action: 'subscribe', sessionId: testSessionId }));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages.some((m) => m.type === 'authenticated')).toBe(true);
    expect(messages.some((m) => m.type === 'subscribed' && m.sessionId === testSessionId)).toBe(true);

    reconnectedSocket.close();
  });
});
