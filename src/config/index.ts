import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env into process.env if present
dotenv.config();

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DATABASE_URL: z.string().optional().default(
    'postgresql://tikuser:tikuser_secret@localhost:5432/tikuser_db?schema=public'
  ),

  // WebSocket & Realtime
  WS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  WS_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  WS_MAX_CONNECTIONS_PER_TENANT: z.coerce.number().int().positive().default(50),

  // TikTok LIVE Connector
  TIKTOK_CONNECTOR_MODE: z.enum(['mock', 'live']).default('mock'),
  USE_MOCK_CONNECTOR: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  TIKTOK_SIGN_API_KEY: z.string().optional().default(''),
  TIKTOK_EXTENDED_GIFT_INFO: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  DEBUG_CONNECTORS: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),

  // Voice Studio TTS
  CIT_VOICE_STUDIO_URL: z.string().url().default('http://127.0.0.1:8001'),
  VOICE_STUDIO_URL: z.string().url().default('http://localhost:3900'),
  VOICE_STUDIO_API_KEY: z.string().optional().default(''),
  VOICE_STUDIO_DEFAULT_VOICE: z.string().default('Minh Đức'),
  VOICE_STUDIO_ENABLED: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
});

const parsedEnv = envSchema.parse(process.env);

export const config = {
  server: {
    port: parsedEnv.PORT,
    host: parsedEnv.HOST,
    nodeEnv: parsedEnv.NODE_ENV,
    logLevel: parsedEnv.LOG_LEVEL,
    isProduction: parsedEnv.NODE_ENV === 'production',
    isTest: parsedEnv.NODE_ENV === 'test',
  },
  database: {
    url: parsedEnv.DATABASE_URL,
  },
  websocket: {
    heartbeatIntervalMs: parsedEnv.WS_HEARTBEAT_INTERVAL_MS,
    ticketTtlSeconds: parsedEnv.WS_TICKET_TTL_SECONDS,
    maxConnectionsPerTenant: parsedEnv.WS_MAX_CONNECTIONS_PER_TENANT,
  },
  tiktok: {
    connectorMode: parsedEnv.TIKTOK_CONNECTOR_MODE,
    useMockConnector: parsedEnv.USE_MOCK_CONNECTOR,
    signApiKey: parsedEnv.TIKTOK_SIGN_API_KEY || undefined,
    extendedGiftInfo: parsedEnv.TIKTOK_EXTENDED_GIFT_INFO,
    debugConnectors: parsedEnv.DEBUG_CONNECTORS,
  },
  voice: {
    citUrl: parsedEnv.CIT_VOICE_STUDIO_URL,
    voiceStudioUrl: parsedEnv.VOICE_STUDIO_URL,
    apiKey: parsedEnv.VOICE_STUDIO_API_KEY || undefined,
    defaultVoice: parsedEnv.VOICE_STUDIO_DEFAULT_VOICE,
    enabled: parsedEnv.VOICE_STUDIO_ENABLED,
  },
} as const;

export type AppConfig = typeof config;
export { parsedEnv as env };

