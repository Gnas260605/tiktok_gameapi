import crypto from 'crypto';
import {
  SessionRepository,
  UserRepository,
  EventRepository,
  EventType,
  SessionStatus,
} from '../../repositories';
import { UserNormalizationService } from '../user/user-normalization.service';
import {
  ITikTokLiveConnector,
  CanonicalEvent,
} from '../../adapters/tiktok/types';

export interface EventIngestionServiceOptions {
  dedupCacheSize?: number;       // default: 50,000 entries
  dedupTtlMs?: number;           // default: 600,000 ms (10 minutes)
  batchFlushIntervalMs?: number; // default: 50 ms
  maxBatchSize?: number;         // default: 50 events
  maxQueueSize?: number;         // default: 5,000 events
  concurrencyLimit?: number;     // default: 15 concurrent DB tasks
}

export interface SessionStatistics {
  totalEvents: number;
  totalDiamonds: number;
  peakViewers: number;
  uniqueUsersCount: number;
  eventCounts: {
    member: number;
    chat: number;
    gift: number;
    like: number;
    follow: number;
    share: number;
    roomUser: number;
  };
  durationSeconds?: number;
}

export interface UserSessionStats {
  userId: string;
  uniqueId: string | null;
  eventCount: number;
  giftCount: number;
  totalDiamonds: number;
  lastActive: Date;
}

export class EventIngestionService {
  private readonly dedupCache: Map<string, number> = new Map();
  private readonly sessionStatsMap: Map<
    string,
    {
      stats: SessionStatistics;
      uniqueUsers: Set<string>;
      userStats: Map<string, UserSessionStats>;
      startTime: Date;
    }
  > = new Map();

  private readonly statusUpdateQueues: Map<string, Promise<void>> = new Map();
  private pendingPromises: Set<Promise<any>> = new Set();
  private dedupCleanupInterval: NodeJS.Timeout | null = null;
  private readonly options: Required<EventIngestionServiceOptions>;

  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly userRepo: UserRepository,
    private readonly eventRepo: EventRepository,
    private readonly userNormalizationService: UserNormalizationService,
    private readonly realtimeBroadcaster?: any,
    options: EventIngestionServiceOptions = {}
  ) {
    this.options = {
      dedupCacheSize: options.dedupCacheSize ?? 50000,
      dedupTtlMs: options.dedupTtlMs ?? 600000,
      batchFlushIntervalMs: options.batchFlushIntervalMs ?? 50,
      maxBatchSize: options.maxBatchSize ?? 50,
      maxQueueSize: options.maxQueueSize ?? 5000,
      concurrencyLimit: options.concurrencyLimit ?? 15,
    };

    // Periodic sweep for expired deduplication keys
    this.dedupCleanupInterval = setInterval(() => {
      this.cleanupDedupCache();
    }, 60000);
  }

  /**
   * Chains a status update task into a per-session FIFO promise queue.
   * Guarantees that asynchronous database status updates execute strictly in the order emitted.
   */
  private enqueueStatusUpdate(
    sessionId: string,
    updateFn: () => Promise<any>
  ): Promise<any> {
    const previousQueue = this.statusUpdateQueues.get(sessionId) || Promise.resolve();

    const currentTask = previousQueue
      .catch(() => {
        // Catch previous errors so a single failed update does not break subsequent updates in the queue
      })
      .then(async () => {
        return await updateFn();
      });

    // Maintain queue reference
    this.statusUpdateQueues.set(
      sessionId,
      currentTask.then(
        () => {},
        () => {}
      )
    );

    this.trackPromise(currentTask);
    return currentTask;
  }

  /**
   * Destroys resources and timers.
   */
  public destroy(): void {
    if (this.dedupCleanupInterval) {
      clearInterval(this.dedupCleanupInterval);
      this.dedupCleanupInterval = null;
    }
    this.dedupCache.clear();
    this.sessionStatsMap.clear();
    this.statusUpdateQueues.clear();
  }

  /**
   * Waits for all in-flight asynchronous ingestion tasks to settle.
   */
  public async waitForPending(): Promise<void> {
    while (this.pendingPromises.size > 0) {
      await Promise.all(Array.from(this.pendingPromises));
    }
  }

  /**
   * Alias for waitForPending for micro-batching test compatibility.
   */
  public async flush(): Promise<void> {
    await this.waitForPending();
  }

  /**
   * Attaches an ITikTokLiveConnector instance to the ingestion pipeline for a given session.
   * Listens for all 7 event types and connection lifecycle status changes.
   */
  public attachConnector(
    tenantId: string,
    sessionId: string,
    connector: ITikTokLiveConnector
  ): { unsubscribe: () => void } {
    this.initSessionStats(sessionId);

    // Event handlers
    const eventHandler = (canonicalEvent: CanonicalEvent) => {
      const task = this.ingestCanonicalEvent(tenantId, sessionId, canonicalEvent).catch((err) => {
        console.error(`Unhandled error during canonical event ingestion on session ${sessionId}: ${err.message}`);
      });
      this.trackPromise(task);
    };

    const connectedHandler = (info: { roomId: string }) => {
      this.enqueueStatusUpdate(sessionId, async () => {
        try {
          await this.sessionRepo.updateStatus(tenantId, sessionId, 'connected', {
            roomId: info?.roomId || connector.getRoomInfo()?.roomId,
            startedAt: new Date(),
          });
        } catch (err: any) {
          console.error(`Failed to update session ${sessionId} to connected: ${err.message}`);
        }
      });
    };

    const reconnectingHandler = (info: { attempt: number; delayMs: number }) => {
      this.enqueueStatusUpdate(sessionId, async () => {
        try {
          await this.sessionRepo.updateStatus(tenantId, sessionId, 'reconnecting', {
            connectorMetadata: {
              reconnectAttempt: info?.attempt,
              delayMs: info?.delayMs,
            },
          });
        } catch (err: any) {
          console.error(`Failed to update session ${sessionId} to reconnecting: ${err.message}`);
        }
      });
    };

    const disconnectedHandler = (info: { reason?: string }) => {
      this.enqueueStatusUpdate(sessionId, async () => {
        try {
          await this.handleSessionDisconnection(
            tenantId,
            sessionId,
            'disconnected',
            info?.reason || 'STOPPED_BY_USER'
          );
        } catch (err: any) {
          console.error(`Failed to update session ${sessionId} to disconnected: ${err.message}`);
        }
      });
    };

    const endedHandler = (info: { reason?: string }) => {
      this.enqueueStatusUpdate(sessionId, async () => {
        try {
          await this.handleSessionDisconnection(
            tenantId,
            sessionId,
            'ended',
            info?.reason || 'LIVE_ENDED_BY_CREATOR'
          );
        } catch (err: any) {
          console.error(`Failed to update session ${sessionId} to ended: ${err.message}`);
        }
      });
    };

    const failedHandler = (info: { reason?: string }) => {
      this.enqueueStatusUpdate(sessionId, async () => {
        try {
          await this.handleSessionDisconnection(
            tenantId,
            sessionId,
            'failed',
            info?.reason || 'CONNECTOR_FAILED'
          );
        } catch (err: any) {
          console.error(`Failed to update session ${sessionId} to failed: ${err.message}`);
        }
      });
    };

    const errorHandler = (err: any) => {
      console.error(`Connector error on session ${sessionId}:`, err);
    };

    // Attach listeners
    const eventTypes = ['member', 'chat', 'gift', 'like', 'follow', 'share', 'roomUser'];
    eventTypes.forEach((type) => {
      connector.on(type, eventHandler);
    });

    connector.on('connected', connectedHandler);
    connector.on('reconnecting', reconnectingHandler);
    connector.on('disconnected', disconnectedHandler);
    connector.on('ended', endedHandler);
    connector.on('failed', failedHandler);
    connector.on('error', errorHandler);

    return {
      unsubscribe: () => {
        eventTypes.forEach((type) => {
          connector.removeListener(type, eventHandler);
        });
        connector.removeListener('connected', connectedHandler);
        connector.removeListener('reconnecting', reconnectingHandler);
        connector.removeListener('disconnected', disconnectedHandler);
        connector.removeListener('ended', endedHandler);
        connector.removeListener('failed', failedHandler);
        connector.removeListener('error', errorHandler);
      },
    };
  }

  /**
   * Direct programmatic ingestion of an event.
   */
  public async ingestEvent(
    event: any,
    options?: { tenantId?: string; sessionId?: string }
  ): Promise<any> {
    const tenantId = event.tenantId || options?.tenantId;
    const sessionId = event.sessionId || options?.sessionId;

    if (!tenantId || !sessionId) {
      throw new Error('Cannot ingest event: tenantId and sessionId are required');
    }

    return this.ingestCanonicalEvent(tenantId, sessionId, event);
  }

  /**
   * Core ingestion pipeline for a single event.
   */
  private async ingestCanonicalEvent(
    tenantId: string,
    sessionId: string,
    event: any
  ): Promise<any> {
    const eventType: EventType = event.eventType || event.type || 'chat';
    const payload = event.payload || event.data || {};
    const occurredAt: Date = event.eventTimestamp || event.occurredAt || new Date();
    const eventId: string = event.id || event.eventId || '';

    // 1. Deduplication Filter
    const dedupKey = this.computeDedupKey(tenantId, sessionId, eventId, eventType, occurredAt, payload);
    if (this.isDuplicate(dedupKey)) {
      return null;
    }
    this.recordDedupKey(dedupKey);

    // 2. User Normalization & Upsert
    let persistedUserId: string | null = null;
    let persistedUser: any = null;

    // CRITICAL: roomUser strictly enforces user: null
    if (eventType !== 'roomUser') {
      const rawUser = event.user || event.sender || payload.user;
      if (rawUser) {
        const normalizedUser = this.userNormalizationService.normalizeUser(rawUser, eventType);
        if (normalizedUser) {
          try {
            const upsertedUser = await this.userRepo.upsertUser(tenantId, {
              platform: normalizedUser.platform,
              platformUserId: normalizedUser.platformUserId,
              uniqueId: normalizedUser.uniqueId,
              nickname: normalizedUser.nickname,
              avatarUrl: normalizedUser.avatarUrl,
              verified: normalizedUser.verified,
              identityQuality: normalizedUser.identityQuality,
              profileObservedAt: normalizedUser.profileObservedAt,
            });

            persistedUserId = upsertedUser.id;
            persistedUser = upsertedUser;

            // Track user session metrics
            this.updateUserStats(sessionId, upsertedUser.id, normalizedUser.uniqueId, eventType, payload, occurredAt);
          } catch (err: any) {
            console.error(`User upsert failed for tenant ${tenantId}: ${err.message}`);
          }
        }
      }
    }

    // 3. Update Session-Level Statistics
    this.updateSessionStats(sessionId, eventType, payload, persistedUserId);

    // 4. Persist Canonical Event into PostgreSQL
    try {
      const persistedEvent = await this.eventRepo.createEvent(tenantId, {
        sessionId,
        userId: persistedUserId,
        eventType,
        occurredAt,
        receivedAt: new Date(),
        data: payload,
        sourceEventId: eventId || null,
        payloadFingerprint: dedupKey,
        connectorName: event.source?.connector || 'mock-connector',
        connectorVersion: event.source?.connectorVersion || '1.0.0',
      });

      // 5. Broadcast to Real-Time Subscribers if available
      if (this.realtimeBroadcaster && typeof this.realtimeBroadcaster.broadcast === 'function') {
        try {
          this.realtimeBroadcaster.broadcast(tenantId, sessionId, { ...persistedEvent, user: persistedUser });
        } catch (broadcastErr: any) {
          console.warn(`Realtime broadcast failed: ${broadcastErr.message}`);
        }
      }

      return persistedEvent;
    } catch (err: any) {
      console.error(`Failed to persist canonical event: ${err.message}`);
      throw err;
    }
  }

  /**
   * Computes deduplication key using eventId or deterministic SHA-256 payload fingerprint.
   */
  private computeDedupKey(
    tenantId: string,
    sessionId: string,
    eventId: string,
    eventType: string,
    occurredAt: Date,
    payload: any
  ): string {
    if (eventId && eventId.trim().length > 0) {
      const raw = `${tenantId}:${sessionId}:${eventId.trim()}`;
      return raw.length <= 128 ? raw : crypto.createHash('sha256').update(raw).digest('hex');
    }

    const timeKey = occurredAt instanceof Date ? occurredAt.getTime() : new Date(occurredAt).getTime();
    const rawFingerprint = `${tenantId}:${sessionId}:${eventType}:${timeKey}:${JSON.stringify(payload)}`;
    return crypto.createHash('sha256').update(rawFingerprint).digest('hex');
  }

  /**
   * Checks if dedup key has been processed recently.
   */
  private isDuplicate(key: string): boolean {
    const expiresAt = this.dedupCache.get(key);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.dedupCache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Records dedup key into sliding window cache.
   */
  private recordDedupKey(key: string): void {
    if (this.dedupCache.size >= this.options.dedupCacheSize) {
      // Evict oldest entries
      const firstKey = this.dedupCache.keys().next().value;
      if (firstKey) this.dedupCache.delete(firstKey);
    }
    this.dedupCache.set(key, Date.now() + this.options.dedupTtlMs);
  }

  /**
   * Cleans up expired dedup keys.
   */
  private cleanupDedupCache(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.dedupCache.entries()) {
      if (now > expiresAt) {
        this.dedupCache.delete(key);
      }
    }
  }

  /**
   * Initializes session statistics tracker.
   */
  private initSessionStats(sessionId: string): void {
    if (!this.sessionStatsMap.has(sessionId)) {
      this.sessionStatsMap.set(sessionId, {
        stats: {
          totalEvents: 0,
          totalDiamonds: 0,
          peakViewers: 0,
          uniqueUsersCount: 0,
          eventCounts: {
            member: 0,
            chat: 0,
            gift: 0,
            like: 0,
            follow: 0,
            share: 0,
            roomUser: 0,
          },
        },
        uniqueUsers: new Set<string>(),
        userStats: new Map<string, UserSessionStats>(),
        startTime: new Date(),
      });
    }
  }

  /**
   * Updates session statistics for an event.
   */
  private updateSessionStats(
    sessionId: string,
    eventType: EventType,
    payload: any,
    userId: string | null
  ): void {
    this.initSessionStats(sessionId);
    const sessionTracker = this.sessionStatsMap.get(sessionId)!;
    const { stats, uniqueUsers } = sessionTracker;

    stats.totalEvents += 1;

    if (eventType in stats.eventCounts) {
      (stats.eventCounts as Record<string, number>)[eventType] += 1;
    }

    if (userId) {
      uniqueUsers.add(userId);
      stats.uniqueUsersCount = uniqueUsers.size;
    }

    if (eventType === 'gift') {
      const diamondCount = Number(payload.diamondCount ?? 0);
      const repeatCount = Number(payload.repeatCount ?? payload.count ?? 1);
      stats.totalDiamonds += diamondCount * repeatCount;
    } else if (eventType === 'roomUser') {
      const viewerCount = Number(payload.viewerCount ?? 0);
      if (viewerCount > stats.peakViewers) {
        stats.peakViewers = viewerCount;
      }
    }
  }

  /**
   * Updates user session metrics.
   */
  private updateUserStats(
    sessionId: string,
    userId: string,
    uniqueId: string | null,
    eventType: EventType,
    payload: any,
    occurredAt: Date
  ): void {
    this.initSessionStats(sessionId);
    const tracker = this.sessionStatsMap.get(sessionId)!;

    let userStat = tracker.userStats.get(userId);
    if (!userStat) {
      userStat = {
        userId,
        uniqueId,
        eventCount: 0,
        giftCount: 0,
        totalDiamonds: 0,
        lastActive: occurredAt,
      };
      tracker.userStats.set(userId, userStat);
    }

    userStat.eventCount += 1;
    userStat.lastActive = occurredAt;

    if (eventType === 'gift') {
      userStat.giftCount += 1;
      const diamondCount = Number(payload.diamondCount ?? 0);
      const repeatCount = Number(payload.repeatCount ?? payload.count ?? 1);
      userStat.totalDiamonds += diamondCount * repeatCount;
    }
  }

  /**
   * Handles session disconnection or termination, persisting aggregate statistics to database.
   */
  private async handleSessionDisconnection(
    tenantId: string,
    sessionId: string,
    status: SessionStatus,
    reason: string
  ): Promise<void> {

    const tracker = this.sessionStatsMap.get(sessionId);
    const durationSeconds = tracker
      ? Math.floor((Date.now() - tracker.startTime.getTime()) / 1000)
      : 0;

    const finalStats: SessionStatistics = tracker
      ? {
          ...tracker.stats,
          uniqueUsersCount: tracker.uniqueUsers.size,
          durationSeconds,
        }
      : {
          totalEvents: 0,
          totalDiamonds: 0,
          peakViewers: 0,
          uniqueUsersCount: 0,
          eventCounts: {
            member: 0,
            chat: 0,
            gift: 0,
            like: 0,
            follow: 0,
            share: 0,
            roomUser: 0,
          },
          durationSeconds: 0,
        };

    const existingSession = await this.sessionRepo.findById(tenantId, sessionId);
    const existingMeta = (existingSession?.connectorMetadata as Record<string, any>) || {};

    await this.sessionRepo.updateStatus(tenantId, sessionId, status, {
      disconnectReason: reason,
      endedAt: new Date(),
      connectorMetadata: {
        ...existingMeta,
        stats: finalStats,
      },
    });
  }

  /**
   * Retrieves current in-memory statistics for a session.
   */
  public getSessionStats(sessionId: string): SessionStatistics | null {
    const tracker = this.sessionStatsMap.get(sessionId);
    if (!tracker) return null;
    return {
      ...tracker.stats,
      uniqueUsersCount: tracker.uniqueUsers.size,
    };
  }

  /**
   * Retrieves in-memory user statistics for a session.
   */
  public getUserSessionStats(sessionId: string, userId: string): UserSessionStats | null {
    const tracker = this.sessionStatsMap.get(sessionId);
    return tracker?.userStats.get(userId) || null;
  }

  /**
   * Tracks an asynchronous promise.
   */
  private trackPromise(p: Promise<any>): void {
    this.pendingPromises.add(p);
    p.finally(() => {
      this.pendingPromises.delete(p);
    });
  }
}
