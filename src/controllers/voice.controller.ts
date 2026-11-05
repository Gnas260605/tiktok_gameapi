import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { VoiceStudioService } from '../services/voice/voice-studio.service';

export function registerVoiceRoutes(
  fastify: FastifyInstance,
  voiceService: VoiceStudioService,
  authPreHandler: any
): void {
  // GET /api/v1/voice/health -> Status check
  fastify.get('/api/v1/voice/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    const health = await voiceService.checkHealth();
    reply.status(200).send({
      success: true,
      data: health,
    });
  });

  // GET /api/v1/voice/voices -> List available voices
  fastify.get('/api/v1/voice/voices', async (_req: FastifyRequest, reply: FastifyReply) => {
    const voices = await voiceService.listVoices();
    reply.status(200).send({
      success: true,
      data: voices,
    });
  });

  // POST /api/v1/voice/tts -> Synthesize text to speech
  fastify.post(
    '/api/v1/voice/tts',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body || {}) as {
        text?: string;
        voice?: string;
        speed?: number;
        format?: 'mp3' | 'wav';
      };

      if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'text is required and must not be empty',
            requestId: request.id,
          },
        });
        return;
      }

      try {
        const result = await voiceService.synthesize(body.text, {
          voice: body.voice,
          speed: body.speed,
          format: body.format,
        });

        const acceptHeader = request.headers.accept || '';
        if (acceptHeader.includes('audio/')) {
          reply
            .header('Content-Type', result.contentType)
            .header('Content-Length', result.audioBuffer.length)
            .status(200)
            .send(result.audioBuffer);
          return;
        }

        reply.status(200).send({
          success: true,
          data: {
            text: body.text.trim(),
            format: result.format,
            durationEstimateMs: result.durationEstimateMs,
            isFallback: result.isFallback,
            audioBase64: `data:${result.contentType};base64,${result.audioBuffer.toString('base64')}`,
          },
        });
      } catch (err: any) {
        reply.status(500).send({
          success: false,
          error: {
            code: 'TTS_SYNTHESIS_FAILED',
            message: err?.message || 'Failed to synthesize speech',
            requestId: request.id,
          },
        });
      }
    }
  );

  // POST /api/v1/voice/alert -> Generate speech announcement for a livestream event
  fastify.post(
    '/api/v1/voice/alert',
    { preHandler: [authPreHandler] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body || {}) as {
        eventType?: string;
        eventData?: any;
        voice?: string;
      };

      if (!body.eventType) {
        reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'eventType is required (e.g. gift, member, follow, share)',
            requestId: request.id,
          },
        });
        return;
      }

      const script = voiceService.formatLiveAlertScript(body.eventType, body.eventData);

      try {
        const result = await voiceService.synthesize(script, {
          voice: body.voice,
        });

        reply.status(200).send({
          success: true,
          data: {
            script,
            format: result.format,
            durationEstimateMs: result.durationEstimateMs,
            isFallback: result.isFallback,
            audioBase64: `data:${result.contentType};base64,${result.audioBuffer.toString('base64')}`,
          },
        });
      } catch (err: any) {
        reply.status(500).send({
          success: false,
          error: {
            code: 'ALERT_SYNTHESIS_FAILED',
            message: err?.message || 'Failed to generate alert audio',
            requestId: request.id,
          },
        });
      }
    }
  );
}

