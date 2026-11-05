import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { PrismaClient } from '@prisma/client';

import {
  UserRepository,
  SessionRepository,
  EventRepository,
  ApiKeyRepository,
  TenantSettingsRepository,
  PlayerRepository,
  BreakthroughRepository,
  GameEventRepository,
  GameConfigRepository,
} from './repositories';

import {
  UserNormalizationService,
  EventIngestionService,
  RealtimeTicketService,
  AuthService,
  SessionService,
  CreatorLookupService,
  VoiceStudioService,
  PlayerService,
  BreakthroughService,
  BreakthroughScheduler,
  LeaderboardService,
  GameConfigService,
} from './services';

import { WebSocketManager } from './websocket';
import { createAuthPreHandler, errorHandler } from './middleware';

import {
  registerDashboardRoutes,
  registerHealthRoutes,
  registerSessionRoutes,
  registerUserRoutes,
  registerEventRoutes,
  registerRealtimeRoutes,
  registerApiKeyRoutes,
  registerCreatorRoutes,
  registerVoiceRoutes,
  registerGameRoutes,
  registerGameAdminRoutes,
} from './controllers';

export interface AppDependencies {
  prisma?: PrismaClient;
  userRepo?: UserRepository;
  sessionRepo?: SessionRepository;
  eventRepo?: EventRepository;
  apiKeyRepo?: ApiKeyRepository;
  tenantSettingsRepo?: TenantSettingsRepository;
  ticketService?: RealtimeTicketService;
  wsManager?: WebSocketManager;
  authService?: AuthService;
  sessionService?: SessionService;
  eventIngestionService?: EventIngestionService;
  creatorLookupService?: CreatorLookupService;
  voiceStudioService?: VoiceStudioService;
  playerRepo?: PlayerRepository;
  playerService?: PlayerService;
  breakthroughRepo?: BreakthroughRepository;
  breakthroughService?: BreakthroughService;
  breakthroughScheduler?: BreakthroughScheduler;
  leaderboardService?: LeaderboardService;
  gameConfigRepo?: GameConfigRepository;
  gameConfigService?: GameConfigService;
  gameEventRepo?: GameEventRepository;
}

export function buildApp(
  dependencies: AppDependencies = {},
  fastifyOptions: { logger?: boolean } = { logger: false }
): FastifyInstance {
  const app = Fastify({
    logger: fastifyOptions.logger,
    trustProxy: true,
  });

  // 1. Dependency Resolution
  const prisma = dependencies.prisma ?? new PrismaClient();
  const userRepo = dependencies.userRepo ?? new UserRepository(prisma);
  const sessionRepo = dependencies.sessionRepo ?? new SessionRepository(prisma);
  const eventRepo = dependencies.eventRepo ?? new EventRepository(prisma);
  const apiKeyRepo = dependencies.apiKeyRepo ?? new ApiKeyRepository(prisma);
  const tenantSettingsRepo =
    dependencies.tenantSettingsRepo ?? new TenantSettingsRepository(prisma);

  const ticketService = dependencies.ticketService ?? new RealtimeTicketService(60);
  const wsManager =
    dependencies.wsManager ?? new WebSocketManager(ticketService);

  const userNormalizationService = new UserNormalizationService();
  const eventIngestionService =
    dependencies.eventIngestionService ??
    new EventIngestionService(
      sessionRepo,
      userRepo,
      eventRepo,
      userNormalizationService,
      wsManager
    );

  const authService = dependencies.authService ?? new AuthService(apiKeyRepo);
  const sessionService =
    dependencies.sessionService ??
    new SessionService(sessionRepo, tenantSettingsRepo, eventIngestionService);

  const creatorLookupService = dependencies.creatorLookupService ?? new CreatorLookupService();
  const voiceStudioService = dependencies.voiceStudioService ?? new VoiceStudioService();

  // Game Dependencies
  const gameConfigRepo = dependencies.gameConfigRepo ?? new GameConfigRepository(prisma);
  const gameConfigService = dependencies.gameConfigService ?? new GameConfigService(gameConfigRepo);
  const playerRepo = dependencies.playerRepo ?? new PlayerRepository(prisma);
  const gameEventRepo = dependencies.gameEventRepo ?? new GameEventRepository(prisma);
  const playerService =
    dependencies.playerService ??
    new PlayerService(playerRepo, gameEventRepo, gameConfigService);

  const breakthroughRepo =
    dependencies.breakthroughRepo ?? new BreakthroughRepository(prisma);
  const breakthroughService =
    dependencies.breakthroughService ??
    new BreakthroughService(
      breakthroughRepo,
      playerRepo,
      gameConfigService,
      gameEventRepo
    );

  const breakthroughScheduler =
    dependencies.breakthroughScheduler ??
    new BreakthroughScheduler(breakthroughService, breakthroughRepo);
  breakthroughService.setScheduler(breakthroughScheduler);

  const leaderboardService =
    dependencies.leaderboardService ?? new LeaderboardService(prisma);

  const authPreHandler = createAuthPreHandler(authService);

  // 2. Plugins
  app.register(fastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'TikUser API',
        description: 'Multi-tenant TikTok LIVE user and event streaming API',
        version: '1.1.0',
      },
      servers: [
        { url: '/api/v1', description: 'API v1 root' },
      ],
      components: {
        securitySchemes: {
          BearerApiKey: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API_KEY',
          },
        },
      },
      security: [{ BearerApiKey: [] }],
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  app.register(fastifyWebsocket, {
    options: {
      maxPayload: 65536,
    },
  });

  // 3. Error Handling
  app.setErrorHandler(errorHandler);

  // 4. Register WebSocket Route
  app.register(async function (wsScope) {
    wsScope.get('/ws', { websocket: true }, (socket: any) => {
      wsManager.handleConnection(socket);
    });
  });

  // 5. Register REST Controllers & Dashboard
  registerDashboardRoutes(app);
  registerHealthRoutes(app, prisma);
  registerSessionRoutes(app, sessionService, authPreHandler);
  registerUserRoutes(app, userRepo, eventRepo, authPreHandler);
  registerEventRoutes(app, eventRepo, authPreHandler);
  registerRealtimeRoutes(app, ticketService, sessionRepo, authPreHandler);
  registerApiKeyRoutes(app, authService, authPreHandler);
  registerCreatorRoutes(app, creatorLookupService, authPreHandler);
  registerVoiceRoutes(app, voiceStudioService, authPreHandler);

  // Tu Tien Live Game Routes
  registerGameRoutes(
    app,
    {
      prisma,
      playerRepo,
      playerService,
      breakthroughRepo,
      breakthroughService,
      breakthroughScheduler,
      leaderboardService,
      gameConfigService,
      gameEventRepo,
      eventIngestionService,
    },
    authPreHandler
  );

  registerGameAdminRoutes(
    app,
    {
      prisma,
      playerRepo,
      playerService,
      breakthroughRepo,
      breakthroughService,
      gameConfigService,
    },
    authPreHandler
  );

  // Recovery hook on startup (TC-B15 / TC-B16)
  app.addHook('onReady', async () => {
    try {
      await breakthroughScheduler.recover();
    } catch (err: any) {
      app.log.error(`Failed to recover breakthrough sessions on startup: ${err.message}`);
    }
  });

  // Graceful shutdown hooks
  app.addHook('onClose', async () => {
    breakthroughScheduler.stopAll();
    gameConfigService.clearCache();
    wsManager.destroy();
    ticketService.destroy();
    await sessionService.destroy();
    eventIngestionService.destroy();
    if (!dependencies.prisma) {
      await prisma.$disconnect();
    }
  });

  return app;
}
