import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { AuthService } from '../../src/services/auth/auth.service';
import { VoiceStudioService } from '../../src/services/voice/voice-studio.service';
import { EventIngestionService } from '../../src/services/event/event-ingestion.service';
import { UserNormalizationService } from '../../src/services/user/user-normalization.service';
import { SessionRepository } from '../../src/repositories/session.repository';
import { UserRepository } from '../../src/repositories/user.repository';
import { EventRepository } from '../../src/repositories/event.repository';
import { EventEmitter } from 'events';

describe('VoiceStudio & Extended Live Events Integration', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let voiceService: VoiceStudioService;

  const tenantId = 'c1111111-1111-4111-8111-111111111111';
  const apiKey = 'tik_voice_test_key_master';
  const keyPrefix = 'tik_voice_key';

  beforeAll(async () => {
    prisma = new PrismaClient();
    voiceService = new VoiceStudioService({ isEnabled: false }); // Test offline fallback mode
    app = buildApp({ prisma, voiceStudioService: voiceService }, { logger: false });
    await app.ready();

    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: { status: 'active', name: 'Voice Test Tenant' },
      create: { id: tenantId, status: 'active', name: 'Voice Test Tenant' },
    });

    await prisma.apiKey.deleteMany({ where: { keyPrefix } });
    await prisma.apiKey.create({
      data: {
        tenantId,
        name: 'Voice Key',
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

  describe('1. VoiceStudioService Unit & Resilience Tests', () => {
    it('returns offline status safely when local VoiceStudio daemon is not running', async () => {
      const health = await voiceService.checkHealth();
      expect(health.status).toBe('offline');
      expect(health.url).toBeDefined();
    });

    it('returns standard voice profiles', async () => {
      const voices = await voiceService.listVoices();
      expect(Array.isArray(voices)).toBe(true);
      expect(voices.length).toBeGreaterThanOrEqual(2);
      expect(voices.some((v) => v.id.includes('vi'))).toBe(true);
    });

    it('formats live alert scripts accurately for all event types', () => {
      // Gift
      const giftScript = voiceService.formatLiveAlertScript('gift', {
        user: { nickname: 'Minh Tuấn' },
        payload: { giftName: 'Hoa Hồng', repeatCount: 10 },
      });
      expect(giftScript).toBe('Cảm ơn Minh Tuấn đã tặng Hoa Hồng nhân 10!');

      // Member join
      const joinScript = voiceService.formatLiveAlertScript('member', {
        user: { nickname: 'Lan Anh' },
      });
      expect(joinScript).toBe('Chào mừng Lan Anh đã tham gia phòng live!');

      // Follow
      const followScript = voiceService.formatLiveAlertScript('follow', {
        user: { nickname: 'Hoàng Nam' },
      });
      expect(followScript).toBe('Cảm ơn Hoàng Nam đã bấm theo dõi kênh!');

      // Question
      const qScript = voiceService.formatLiveAlertScript('questionNew', {
        user: { nickname: 'Hồng Ngọc' },
        payload: { questionText: 'Shop có freeship không?' },
      });
      expect(qScript).toBe('Câu hỏi mới từ Hồng Ngọc: Shop có freeship không?');
    });

    it('generates valid fallback audio buffer with WAV RIFF header', async () => {
      const result = await voiceService.synthesize('Xin chào các bạn đã xem livestream');
      expect(result.isFallback).toBe(true);
      expect(result.format).toBe('wav');
      expect(result.contentType).toBe('audio/wav');
      expect(result.audioBuffer.length).toBeGreaterThan(100);

      // Verify RIFF/WAVE header bytes
      const magic = result.audioBuffer.subarray(0, 4).toString('ascii');
      const wave = result.audioBuffer.subarray(8, 12).toString('ascii');
      expect(magic).toBe('RIFF');
      expect(wave).toBe('WAVE');
    });

    it('rejects empty text with an error', async () => {
      await expect(voiceService.synthesize('   ')).rejects.toThrow('Text to synthesize cannot be empty');
    });

    it('successfully connects to CIT Voice Studio (:8001) and generates speech when active', async () => {
      const mockFetch = vi.fn(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/health')) {
          return { ok: true, status: 200 } as any;
        }
        if (urlStr.includes('/voices')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: 'Minh Đức', name: 'Minh Đức (Nam - Bắc)', language: 'vi' },
              { id: 'Mai Chi', name: 'Mai Chi (Nữ - Bắc)', language: 'vi' },
            ],
          } as any;
        }
        if (urlStr.includes('/api/tts/generate')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'audio/wav' }),
            arrayBuffer: async () => Buffer.from('RIFF....WAVEfmt ....data....').buffer,
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch as any;

      try {
        const citService = new VoiceStudioService({
          citUrl: 'http://127.0.0.1:8001',
          isEnabled: true,
        });

        // 1. Health check returns cit-voice-studio engine
        const health = await citService.checkHealth();
        expect(health.status).toBe('connected');
        expect(health.engine).toBe('cit-voice-studio');
        expect(health.url).toBe('http://127.0.0.1:8001');

        // 2. List voices returns CIT voices
        const voices = await citService.listVoices();
        expect(voices.some((v) => v.id === 'Minh Đức')).toBe(true);

        // 3. Synthesize calls /api/tts/generate
        const synth = await citService.synthesize('Cảm ơn bạn đã xem live', { voice: 'Minh Đức' });
        expect(synth.isFallback).toBe(false);
        expect(synth.engineUsed).toBe('cit-voice-studio');
        expect(synth.format).toBe('wav');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('2. Voice REST API Controller Tests', () => {
    it('GET /api/v1/voice/health returns 200 with status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/health',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('offline');
    });

    it('GET /api/v1/voice/voices returns list of available voices', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/voices',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/v1/voice/tts rejects empty text with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/tts',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: { text: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/v1/voice/tts synthesizes speech and returns Base64 audio', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/tts',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: { text: 'Cảm ơn bạn đã xem live!', voice: 'vi_female' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.audioBase64).toContain('data:audio/wav;base64,');
      expect(body.data.durationEstimateMs).toBeGreaterThan(0);
    });

    it('POST /api/v1/voice/alert synthesizes livestream event announcement', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/alert',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: {
          eventType: 'gift',
          eventData: {
            user: { nickname: 'FanCung123' },
            payload: { giftName: 'Trái Tim', repeatCount: 5 },
          },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.script).toContain('Cảm ơn FanCung123 đã tặng Trái Tim nhân 5!');
      expect(body.data.audioBase64).toBeDefined();
    });
  });

  describe('3. Extended Events Realtime Propagation', () => {
    it('EventIngestionService propagates linkMicBattle and questionNew to realtime broadcaster', async () => {
      const mockSessionRepo = new SessionRepository(prisma);
      const mockUserRepo = new UserRepository(prisma);
      const mockEventRepo = new EventRepository(prisma);
      const userNorm = new UserNormalizationService();

      const broadcastMock = {
        broadcastEvent: vi.fn(),
      };

      const ingestionService = new EventIngestionService(
        mockSessionRepo,
        mockUserRepo,
        mockEventRepo,
        userNorm,
        broadcastMock
      );

      class TestConnector extends EventEmitter {
        getStatus() { return 'connected' as any; }
        getRoomInfo() { return null; }
        isConnected() { return true; }
        async connect() { return { success: true, status: 'connected' as any }; }
        async disconnect() {}
      }

      const connector = new TestConnector();
      const sub = ingestionService.attachConnector('tenant_test_ext', 'session_test_ext', connector as any);

      // Emit extended event: linkMicBattle
      connector.emit('linkMicBattle', {
        id: 'battle_event_1',
        sessionId: 'session_test_ext',
        eventType: 'linkMicBattle',
        eventTimestamp: new Date(),
        user: null,
        payload: { battleId: 'pk_123', status: 'ongoing' },
      });

      expect(broadcastMock.broadcastEvent).toHaveBeenCalledWith(
        'tenant_test_ext',
        'session_test_ext',
        expect.objectContaining({
          type: 'linkMicBattle',
          data: { battleId: 'pk_123', status: 'ongoing' },
        })
      );

      // Emit extended event: questionNew
      connector.emit('questionNew', {
        id: 'q_event_1',
        sessionId: 'session_test_ext',
        eventType: 'questionNew',
        eventTimestamp: new Date(),
        user: { uniqueId: 'viewer_q' },
        payload: { questionText: 'Bao giờ shop ship?' },
      });

      expect(broadcastMock.broadcastEvent).toHaveBeenCalledWith(
        'tenant_test_ext',
        'session_test_ext',
        expect.objectContaining({
          type: 'questionNew',
          data: { questionText: 'Bao giờ shop ship?' },
        })
      );

      sub.unsubscribe();
      ingestionService.destroy();
    });
  });
});
