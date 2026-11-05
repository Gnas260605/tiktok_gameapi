import { LiveSession } from '@prisma/client';
import { SessionRepository } from '../../repositories/session.repository';
import { TenantSettingsRepository } from '../../repositories/tenant-settings.repository';
import { EventIngestionService } from '../event/event-ingestion.service';
import { ConnectorFactory } from '../../adapters/tiktok/connector.factory';
import { ITikTokLiveConnector } from '../../adapters/tiktok/types';
import {
  ListSessionsFilter,
  CursorPagination,
  PaginatedResult,
} from '../../repositories/types';

export interface CreateSessionOptions {
  creatorUsername: string;
  reconnect?: boolean;
  mode?: 'mock' | 'live';
  mockTickerIntervalMs?: number;
}

export class SessionService {
  private readonly activeConnectors = new Map<string, ITikTokLiveConnector>();

  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly tenantSettingsRepo: TenantSettingsRepository,
    private readonly eventIngestionService: EventIngestionService
  ) {}

  /**
   * Creates a new LIVE session and starts the connector asynchronously.
   * Duplicate active sessions for same creator in the same tenant throw 409 Conflict.
   */
  public async createSession(
    tenantId: string,
    options: CreateSessionOptions
  ): Promise<LiveSession> {
    const rawUsername = options.creatorUsername;
    if (!rawUsername || typeof rawUsername !== 'string') {
      const err = new Error('creatorUsername is required');
      (err as any).statusCode = 400;
      (err as any).code = 'BAD_REQUEST';
      throw err;
    }

    const normalizedUsername = rawUsername.trim().replace(/^@+/, '').toLowerCase();
    const usernameRegex = /^[a-z0-9._]{2,255}$/;
    if (!usernameRegex.test(normalizedUsername)) {
      const err = new Error(
        'creatorUsername must be between 2 and 255 characters and contain only letters, numbers, underscores, or dots'
      );
      (err as any).statusCode = 400;
      (err as any).code = 'BAD_REQUEST';
      throw err;
    }

    // 1. Check for duplicate active session
    const existingActive = await this.sessionRepo.findActiveByCreator(
      tenantId,
      'tiktok',
      normalizedUsername
    );
    // Connectors live in process memory, so an "active" row with no connector here
    // was orphaned by a restart or crash; close it instead of blocking forever.
    // Assumes a single API instance owns all connectors (see docs/DEPLOYMENT.md).
    if (existingActive && !this.activeConnectors.has(existingActive.id)) {
      await this.sessionRepo.updateStatus(tenantId, existingActive.id, 'disconnected', {
        endedAt: new Date(),
        disconnectReason: 'ORPHANED_BY_RESTART',
      });
    } else if (existingActive) {
      const err = new Error(
        `Active session already exists for creator '${normalizedUsername}' in this tenant`
      );
      (err as any).statusCode = 409;
      (err as any).code = 'CONFLICT';
      throw err;
    }

    // 2. Check tenant quota limit
    const settings = await this.tenantSettingsRepo.getSettings(tenantId);
    if (settings && settings.maxActiveSessions) {
      const activeSessions = await this.sessionRepo.list(
        tenantId,
        {
          status: 'connected',
        },
        { limit: settings.maxActiveSessions + 1 }
      );
      if (activeSessions.items.length >= settings.maxActiveSessions) {
        const err = new Error(
          `Tenant active session quota limit (${settings.maxActiveSessions}) exceeded`
        );
        (err as any).statusCode = 429;
        (err as any).code = 'RATE_LIMITED';
        throw err;
      }
    }

    // 3. Persist session with queued status
    const session = await this.sessionRepo.create(tenantId, {
      creatorUsername: normalizedUsername,
      platform: 'tiktok',
      connectorMetadata: {
        reconnect: options.reconnect ?? true,
        mode: options.mode ?? (process.env.TIKTOK_CONNECTOR_MODE || 'mock'),
      },
    });

    // 4. Instantiate connector
    const connectorOptions = {
      tenantId,
      sessionId: session.id,
      isMock: options.mode === 'mock' ? true : (options.mode === 'live' ? false : undefined),
      maxReconnectAttempts: options.reconnect === false ? 0 : 5,
      mockTickerIntervalMs: options.mockTickerIntervalMs,
    };

    const connector = ConnectorFactory.createConnector(connectorOptions);

    this.activeConnectors.set(session.id, connector);

    // 5. Wire into EventIngestionService
    this.eventIngestionService.attachConnector(tenantId, session.id, connector);

    // 6. Connect asynchronously
    connector
      .connect(normalizedUsername, connectorOptions)
      .then(async (result) => {
        if (result.success) {
          const roomInfo = connector.getRoomInfo();
          await this.sessionRepo.updateStatus(tenantId, session.id, 'connected', {
            roomId: result.roomId ?? undefined,
            startedAt: new Date(),
            connectorMetadata: {
              reconnect: options.reconnect ?? true,
              mode: options.mode ?? (process.env.TIKTOK_CONNECTOR_MODE || 'mock'),
              title: roomInfo?.title || null,
              hlsPullUrl: roomInfo?.hlsPullUrl || null,
              flvPullUrl: roomInfo?.flvPullUrl || null,
              coverUrl: roomInfo?.coverUrl || null,
              ownerNickname: roomInfo?.ownerNickname || null,
              ownerBio: roomInfo?.ownerBio || null,
            },
          });
        } else {
          await this.sessionRepo.updateStatus(
            tenantId,
            session.id,
            result.status === 'ended' ? 'ended' : 'failed',
            {
              disconnectReason: result.error ?? 'Connection failed',
              ...(result.status === 'ended' && { endedAt: new Date() }),
            }
          );
          this.activeConnectors.delete(session.id);
        }
      })
      .catch(async (err: any) => {
        await this.sessionRepo.updateStatus(tenantId, session.id, 'failed', {
          disconnectReason: err?.message || 'Connection crashed',
        });
        this.activeConnectors.delete(session.id);
      });

    return session;
  }

  public async getSession(tenantId: string, sessionId: string): Promise<LiveSession | null> {
    return this.sessionRepo.findById(tenantId, sessionId);
  }

  public async listSessions(
    tenantId: string,
    filter: ListSessionsFilter = {},
    pagination: CursorPagination = {}
  ): Promise<PaginatedResult<LiveSession>> {
    return this.sessionRepo.list(tenantId, filter, pagination);
  }

  /**
   * Gracefully disconnects a LIVE session.
   */
  public async disconnectSession(tenantId: string, sessionId: string): Promise<LiveSession> {
    const session = await this.sessionRepo.findById(tenantId, sessionId);
    if (!session) {
      const err = new Error('Session not found');
      (err as any).statusCode = 404;
      (err as any).code = 'NOT_FOUND';
      throw err;
    }

    const connector = this.activeConnectors.get(sessionId);
    if (connector) {
      try {
        await connector.disconnect('api_request');
      } catch {
        // ignore
      }
      this.activeConnectors.delete(sessionId);
    }

    const updated = await this.sessionRepo.updateStatus(tenantId, sessionId, 'ended', {
      endedAt: new Date(),
      disconnectReason: 'api_request',
    });

    return updated ?? session;
  }

  /**
   * Sends a chat message into a live session's room.
   */
  public async sendChatMessage(
    tenantId: string,
    sessionId: string,
    message: string
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    const session = await this.sessionRepo.findById(tenantId, sessionId);
    if (!session) {
      const err = new Error('Session not found');
      (err as any).statusCode = 404;
      (err as any).code = 'NOT_FOUND';
      throw err;
    }

    if (session.status !== 'connected') {
      const err = new Error(`Cannot send message to a session in '${session.status}' status`);
      (err as any).statusCode = 400;
      (err as any).code = 'BAD_REQUEST';
      throw err;
    }

    const connector = this.activeConnectors.get(sessionId);
    if (!connector || typeof connector.sendMessage !== 'function') {
      const err = new Error('Connector is not active or does not support sending messages');
      (err as any).statusCode = 503;
      (err as any).code = 'SERVICE_UNAVAILABLE';
      throw err;
    }

    return connector.sendMessage(message);
  }

  public getActiveConnector(sessionId: string): ITikTokLiveConnector | undefined {
    return this.activeConnectors.get(sessionId);
  }

  public async destroy(): Promise<void> {
    for (const [, connector] of this.activeConnectors.entries()) {
      try {
        await connector.disconnect('server_shutdown');
      } catch {
        // ignore
      }
    }
    this.activeConnectors.clear();
  }
}
