import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';
import { MockConnector } from '../../src/adapters/tiktok/mock.connector';
import { LiveTikTokConnector } from '../../src/adapters/tiktok/live.connector';

describe('TikTok-Live-Connector v2.5.0 Integration Features', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  const tenantId = 'e2222222-2222-4222-8222-222222222222';
  const apiKey = 'tik_live_features_test_key_master';
  const keyPrefix = 'tik_feat_key';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = buildApp({ prisma }, { logger: false });
    await app.ready();

    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: { status: 'active', name: 'Features Test Tenant' },
      create: { id: tenantId, status: 'active', name: 'Features Test Tenant' },
    });

    await prisma.apiKey.deleteMany({ where: { keyPrefix } });
    await prisma.apiKey.create({
      data: {
        tenantId,
        name: 'Features Key',
        keyPrefix,
        keyHash: AuthService.hashKey(apiKey),
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { tenantId } });
    await prisma.liveSession.deleteMany({ where: { tenantId } });
    await prisma.apiKey.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
    await prisma.$disconnect();
  });

  describe('1. Enriched Stream Metadata (HLS/FLV Pull URLs)', () => {
    it('MockConnector provides hlsPullUrl, flvPullUrl, and coverUrl in roomInfo', async () => {
      const connector = new MockConnector();
      const res = await connector.connect('streamer_video_test', {
        tenantId,
        sessionId: 'session_video_1',
      });

      expect(res.success).toBe(true);
      const room = connector.getRoomInfo();
      expect(room).toBeDefined();
      expect(room?.hlsPullUrl).toContain('.m3u8');
      expect(room?.flvPullUrl).toContain('.flv');
      expect(room?.coverUrl).toBeDefined();
      expect(room?.ownerNickname).toBeDefined();

      await connector.disconnect();
    });

    it('LiveTikTokConnector extracts stream URLs and owner details when connecting', async () => {
      const connector = new LiveTikTokConnector();
      // Test connect with mock upstream returns
      const res = await connector.connect('anvatcomai.food', {
        tenantId,
        sessionId: 'session_live_meta_1',
      });

      expect(res.success).toBe(true);
      const room = connector.getRoomInfo();
      expect(room).toBeDefined();
      expect(room?.creatorUsername).toBe('anvatcomai.food');

      await connector.disconnect();
    });
  });

  describe('2. Two-Way Chat (sendMessage API)', () => {
    it('MockConnector.sendMessage emits a chat event and returns success result', async () => {
      const connector = new MockConnector();
      await connector.connect('chat_target_streamer', {
        tenantId,
        sessionId: 'session_chat_1',
      });

      let receivedChat: any = null;
      connector.on('chat', (event) => {
        receivedChat = event;
      });

      const sendResult = await connector.sendMessage('Hello from Antigravity bot!');
      expect(sendResult.success).toBe(true);
      expect(sendResult.result?.messageId).toBeDefined();

      expect(receivedChat).toBeDefined();
      expect(receivedChat.payload.comment).toBe('Hello from Antigravity bot!');
      expect(receivedChat.user.uniqueId).toBe('tikuser_bot');

      await connector.disconnect();
    });

    it('MockConnector.sendMessage fails when not connected or message is empty', async () => {
      const connector = new MockConnector();
      const resOffline = await connector.sendMessage('Hello');
      expect(resOffline.success).toBe(false);
      expect(resOffline.error).toBe('Connector is not connected');

      await connector.connect('test_streamer', { tenantId, sessionId: 's1' });
      const resEmpty = await connector.sendMessage('   ');
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.error).toBe('Message content cannot be empty');

      await connector.disconnect();
    });

    it('POST /api/v1/live/sessions/:sessionId/chat sends chat to active session', async () => {
      // 1. Create a session
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/live/sessions',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: { creatorUsername: 'bot_interactive_creator', mode: 'mock' },
      });
      expect(createRes.statusCode).toBe(202);
      const sessionId = JSON.parse(createRes.body).data.id;

      // Allow connector to transition to connected
      await new Promise((r) => setTimeout(r, 60));

      // 2. Validate empty message rejection
      const emptyRes = await app.inject({
        method: 'POST',
        url: `/api/v1/live/sessions/${sessionId}/chat`,
        headers: { authorization: `Bearer ${apiKey}` },
        payload: { message: '' },
      });
      expect(emptyRes.statusCode).toBe(400);

      // 3. Send valid message
      const chatRes = await app.inject({
        method: 'POST',
        url: `/api/v1/live/sessions/${sessionId}/chat`,
        headers: { authorization: `Bearer ${apiKey}` },
        payload: { message: 'Awesome livestream!' },
      });
      expect(chatRes.statusCode).toBe(200);
      const chatBody = JSON.parse(chatRes.body);
      expect(chatBody.success).toBe(true);
      expect(chatBody.data.messageId).toBeDefined();

      // 4. Verify session details API returns enriched metadata
      const sessionRes = await app.inject({
        method: 'GET',
        url: `/api/v1/live/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${apiKey}` },
      });
      expect(sessionRes.statusCode).toBe(200);
      const sessionBody = JSON.parse(sessionRes.body);
      expect(sessionBody.data.metadata).toBeDefined();
      expect(sessionBody.data.metadata.hlsPullUrl).toBeDefined();

      // Clean up session
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/live/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${apiKey}` },
      });
    });
  });
});

