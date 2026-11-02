import { v4 as uuidv4 } from 'uuid';
import { BaseConnector } from './base.connector';
import {
  ConnectorOptions,
  ConnectionResult,
  CanonicalEvent,
  EventType,
} from './types';
import { UserNormalizationService } from '../../services/user/user-normalization.service';

export class LiveTikTokConnector extends BaseConnector {
  private liveConnection: any = null;
  private normalizationService: UserNormalizationService;

  constructor(normalizationService?: UserNormalizationService) {
    super();
    this.normalizationService = normalizationService || new UserNormalizationService();
  }

  /**
   * Connects to a real TikTok LIVE room using tiktok-live-connector with dynamic import.
   */
  public async connect(
    creatorUsername: string,
    options?: ConnectorOptions
  ): Promise<ConnectionResult> {
    this.options = options ?? {
      sessionId: `live_session_${uuidv4()}`,
      tenantId: `live_tenant_${uuidv4()}`,
    };
    this.creatorUsername = this.normalizeCreatorUsername(creatorUsername);
    this.isExplicitlyStopped = false;
    this.reconnectAttempts = 0;

    this.transitionTo('connecting');

    try {
      // 1. Dynamic import of tiktok-live-connector with defensive fallback
      let TikTokLiveConnectorModule: any;
      try {
        TikTokLiveConnectorModule = await import('tiktok-live-connector');
      } catch (importErr: any) {
        const errorMsg =
          'tiktok-live-connector package is not installed or available in this environment. ' +
          'Please ensure the dependency is installed or use MockConnector for offline development/testing.';
        this.safeLog('error', errorMsg);
        this.transitionTo('failed', 'CONNECTOR_LIBRARY_NOT_INSTALLED');
        return {
          success: false,
          status: 'failed',
          error: errorMsg,
        };
      }

      const WebcastPushConnection =
        TikTokLiveConnectorModule.WebcastPushConnection ||
        TikTokLiveConnectorModule.default?.WebcastPushConnection ||
        TikTokLiveConnectorModule.default;

      if (!WebcastPushConnection) {
        throw new Error('Failed to resolve WebcastPushConnection from tiktok-live-connector module');
      }

      // 2. Instantiate upstream connection
      this.liveConnection = new WebcastPushConnection(this.creatorUsername, {
        processInitialData: false,
        enableExtendedGiftInfo: options?.enableExtendedGiftInfo ?? true,
        requestPollingIntervalMs: options?.requestPollingIntervalMs ?? 1000,
        clientParams: options?.clientParams ?? {},
      });

      // 3. Bind upstream event listeners
      this.bindUpstreamEvents();

      // 4. Connect to upstream TikTok Webcast
      const state = await this.liveConnection.connect();

      this.roomInfo = {
        roomId: String(state?.roomId || this.liveConnection.roomId || uuidv4()),
        creatorUsername: this.creatorUsername,
        title: state?.roomInfo?.title || null,
        viewerCount: state?.roomInfo?.user_count || 0,
        startedAt: new Date(),
      };

      this.transitionTo('connected');

      return {
        success: true,
        roomId: this.roomInfo.roomId,
        status: 'connected',
      };
    } catch (err: any) {
      this.safeLog('error', `Live connection failed for @${this.creatorUsername}: ${err.message}`, err.stack);

      const isRoomOffline =
        err.message?.includes('LIVE_NOT_FOUND') ||
        err.message?.includes('offline') ||
        err.message?.includes('Room not found') ||
        err.message?.includes('ROOM_OFFLINE');

      const finalStatus = isRoomOffline ? 'ended' : 'failed';
      this.transitionTo(finalStatus, err.message);

      return {
        success: false,
        status: finalStatus,
        error: err.message,
      };
    }
  }

  /**
   * Gracefully disconnects the live stream connection.
   */
  public async disconnect(reason: string = 'STOPPED_BY_USER'): Promise<void> {
    this.isExplicitlyStopped = true;
    this.clearReconnectTimer();

    if (this.liveConnection) {
      try {
        await this.liveConnection.disconnect();
      } catch (err: any) {
        this.safeLog('warn', `Error during upstream disconnect: ${err.message}`);
      } finally {
        this.unbindUpstreamEvents();
        this.liveConnection = null;
      }
    }

    this.transitionTo('disconnected', reason);
  }

  /**
   * Binds upstream Webcast event listeners and maps them to CanonicalEvents.
   */
  private bindUpstreamEvents(): void {
    if (!this.liveConnection) return;

    // 1. Member join
    this.liveConnection.on('member', (raw: any) => {
      this.handleIncomingRawEvent('member', raw, {
        joinMethod: raw?.displayType || 'enter_room',
        sourceFields: raw,
      });
    });

    // 2. Chat comment
    this.liveConnection.on('chat', (raw: any) => {
      const commentText = raw?.comment || raw?.text || '';
      this.handleIncomingRawEvent('chat', raw, {
        comment: commentText,
        text: commentText,
        messageId: raw?.msgId || raw?.id || null,
        emotes: raw?.emotes || [],
      });
    });

    // 3. Gift
    this.liveConnection.on('gift', (raw: any) => {
      this.handleIncomingRawEvent('gift', raw, {
        giftId: String(raw?.giftId || raw?.id || 'unknown'),
        giftName: raw?.giftName || 'Unknown Gift',
        diamondCount: raw?.diamondCount !== undefined ? Number(raw.diamondCount) : null,
        repeatCount: raw?.repeatCount ? Number(raw.repeatCount) : 1,
        repeatEnd: raw?.repeatEnd !== undefined ? Boolean(raw.repeatEnd) : true,
        giftType: raw?.giftType ? Number(raw.giftType) : null,
        groupId: raw?.groupId ? String(raw.groupId) : null,
      });
    });

    // 4. Like
    this.liveConnection.on('like', (raw: any) => {
      this.handleIncomingRawEvent('like', raw, {
        likeCount: Number(raw?.likeCount || 1),
        totalLikes: raw?.totalLikeCount ? Number(raw.totalLikeCount) : null,
      });
    });

    // 5. Social (Follow / Share)
    this.liveConnection.on('social', (raw: any) => {
      const displayType = String(raw?.displayType || '');
      if (displayType.includes('share')) {
        this.handleIncomingRawEvent('share', raw, {
          shareType: raw?.shareType || 'social_share',
          shareTarget: raw?.shareTarget || 'unknown',
        });
      } else {
        this.handleIncomingRawEvent('follow', raw, {
          followType: displayType || 'live_follow',
          sourceFields: raw,
        });
      }
    });

    // 6. RoomUser viewer count statistics (STRICTLY user: null)
    this.liveConnection.on('roomUser', (raw: any) => {
      const count = Number(raw?.viewerCount || raw?.userCount || 0);
      if (this.roomInfo) {
        this.roomInfo.viewerCount = count;
      }
      this.handleIncomingRawEvent('roomUser', raw, { viewerCount: count });
    });

    // 7. Stream end
    this.liveConnection.on('streamEnd', () => {
      this.safeLog('info', `Stream ended by creator @${this.creatorUsername}`);
      this.transitionTo('ended', 'LIVE_ENDED_BY_CREATOR');
    });

    // 8. Connection drop / disconnect
    this.liveConnection.on('disconnected', () => {
      if (!this.isExplicitlyStopped && (this.status === 'connected' || this.status === 'connecting')) {
        this.safeLog('warn', `Connection lost to @${this.creatorUsername}. Initiating backoff retry.`);
        this.handleReconnection();
      }
    });

    // 9. Upstream error
    this.liveConnection.on('error', (err: any) => {
      this.safeLog('error', `Upstream connector error: ${err.message}`, err);
      this.safeEmit('error', {
        code: 'UPSTREAM_CONNECTOR_ERROR',
        message: err.message || 'Unknown upstream error',
        details: err,
      });
    });
  }

  /**
   * Unbinds upstream event listeners to prevent memory leaks.
   */
  private unbindUpstreamEvents(): void {
    if (!this.liveConnection) return;
    try {
      this.liveConnection.removeAllListeners();
    } catch (err: any) {
      this.safeLog('warn', `Error removing upstream listeners: ${err.message}`);
    }
  }

  /**
   * Transforms raw upstream payload into CanonicalEvent and emits it.
   */
  private handleIncomingRawEvent(eventType: EventType, raw: any, payload: any): void {
    if (!this.options) return;

    // Normalize user using UserNormalizationService
    // STRICT RULE: roomUser always has user: null
    const normalizedUser =
      eventType === 'roomUser'
        ? null
        : this.normalizationService.normalizeUserFromEvent(raw, eventType);

    const canonicalEvent: CanonicalEvent = {
      id: uuidv4(),
      tenantId: this.options.tenantId,
      sessionId: this.options.sessionId,
      eventType,
      eventTimestamp: raw?.timestamp ? new Date(Number(raw.timestamp)) : new Date(),
      user: normalizedUser,
      payload,
      source: {
        connector: 'tiktok-live-connector',
        connectorVersion: '1.0.0',
      },
    };

    this.safeEmit(eventType, canonicalEvent);
  }

  /**
   * Executes bounded exponential backoff reconnection loop.
   */
  private async handleReconnection(): Promise<void> {
    if (this.isExplicitlyStopped) return;

    this.transitionTo('reconnecting', 'NETWORK_DISCONNECT');

    if (this.reconnectAttempts >= this.maxRetries) {
      this.safeLog('error', `Max reconnection attempts (${this.maxRetries}) exhausted. Marking session as failed.`);
      this.transitionTo('failed', 'MAX_RETRIES_EXCEEDED');
      return;
    }

    const delayMs = this.calculateBackoffDelay(this.reconnectAttempts);
    this.reconnectAttempts++;

    this.safeLog(
      'info',
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxRetries} in ${delayMs}ms`
    );

    this.safeEmit('reconnecting', { attempt: this.reconnectAttempts, delayMs });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(async () => {
      if (this.isExplicitlyStopped || this.status !== 'reconnecting') return;

      try {
        if (!this.liveConnection) {
          throw new Error('Live connection instance was torn down');
        }

        this.safeLog('info', `Executing reconnect attempt ${this.reconnectAttempts}...`);
        await this.liveConnection.reconnect();

        this.safeLog('info', `Reconnection attempt ${this.reconnectAttempts} succeeded!`);
        this.reconnectAttempts = 0;
        this.transitionTo('connected', 'RECONNECTED_SUCCESSFULLY');
      } catch (err: any) {
        this.safeLog('warn', `Reconnect attempt ${this.reconnectAttempts} failed: ${err.message}`);
        this.handleReconnection();
      }
    }, delayMs);
  }
}
