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
} from './repositories';
import { UserNormalizationService } from './services/user/user-normalization.service';
import { EventIngestionService } from './services/event/event-ingestion.service';
import { RealtimeTicketService } from './services/realtime/ticket.service';
import { WebSocketManager } from './websocket/websocket-manager';
import { AuthService } from './services/auth/auth.service';
import { SessionService } from './services/session/session.service';
import { CreatorLookupService } from './services/tiktok/creator-lookup.service';

import { createAuthPreHandler } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error-handler';

import { registerHealthRoutes } from './controllers/health.controller';
import { registerSessionRoutes } from './controllers/session.controller';
import { registerUserRoutes } from './controllers/user.controller';
import { registerEventRoutes } from './controllers/event.controller';
import { registerRealtimeRoutes } from './controllers/realtime.controller';
import { registerApiKeyRoutes } from './controllers/api-key.controller';
import { registerDashboardRoutes } from './controllers/dashboard.controller';
import { registerCreatorRoutes } from './controllers/creator.controller';

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

  // Graceful shutdown hooks
  app.addHook('onClose', async () => {
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
