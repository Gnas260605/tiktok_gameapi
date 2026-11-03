import { v4 as uuidv4 } from 'uuid';
import { BaseConnector } from './base.connector';
import {
  ConnectorOptions,
  ConnectionResult,
  CanonicalEvent,
  EventType,
} from './types';
import { UserNormalizationService } from '../../services/user/user-normalization.service';
import { classifyUpstreamError } from './upstream-errors';

/**
 * Production adapter over tiktok-live-connector v2 (TikTokLiveConnection, proto v3 payloads).
 *
 * The upstream WebSocket URL is signed by the Euler Stream sign server, which
 * requires TIKTOK_SIGN_API_KEY. Gift catalogue fetching (enableExtendedGiftInfo)
 * is a Business-plan endpoint, so it is opt-in via TIKTOK_EXTENDED_GIFT_INFO=true;
 * gift name, diamond value and image already arrive on every gift message.
 */
export class LiveTikTokConnector extends BaseConnector {
  private liveConnection: any = null;
  private normalizationService: UserNormalizationService;

  constructor(normalizationService?: UserNormalizationService) {
    super();
    this.normalizationService = normalizationService || new UserNormalizationService();
  }

  public async connect(
    creatorUsername: string,
    options?: ConnectorOptions
  ): Promise<ConnectionResult> {
    if (this.status === 'disconnected' || this.status === 'ended' || this.status === 'failed') {
      return {
        success: false,
        status: this.status,
        error: `Connector is in terminal state (${this.status})`,
      };
    }

    const normalized = this.normalizeCreatorUsername(creatorUsername);
    if (!normalized || normalized.length === 0) {
      return {
        success: false,
        status: 'failed',
        error: 'Creator username cannot be empty',
      };
    }

    this.options = options ?? {
      sessionId: `live_session_${uuidv4()}`,
      tenantId: `live_tenant_${uuidv4()}`,
    };
    this.creatorUsername = normalized;
    this.isExplicitlyStopped = false;
    this.reconnectAttempts = 0;
    this.maxRetries = this.options.maxReconnectAttempts ?? 5;

    this.transitionTo('connecting');

    try {
      this.liveConnection = await this.createUpstreamConnection(this.options);
    } catch (err: any) {
      this.safeLog('error', err.message);
      this.transitionTo('failed', 'CONNECTOR_LIBRARY_NOT_INSTALLED');
      return { success: false, status: 'failed', error: err.message };
    }

    this.bindUpstreamEvents();

    try {
      const state = await this.liveConnection.connect();
      if (this.isExplicitlyStopped) {
        return { success: false, status: this.status, error: 'Stopped during connect' };
      }

      const upstreamRoom = state?.roomInfo?.data ?? state?.roomInfo ?? {};
      this.roomInfo = {
        roomId: String(state?.roomId || this.liveConnection.roomId || uuidv4()),
        creatorUsername: this.creatorUsername,
        title: upstreamRoom.title || null,
        viewerCount: upstreamRoom.user_count || 0,
        startedAt: new Date(),
      };

      this.transitionTo('connected');
      return { success: true, roomId: this.roomInfo.roomId, status: 'connected' };
    } catch (err: any) {
      const classified = classifyUpstreamError(err, this.creatorUsername);
      this.safeLog('error', `Live connection failed for @${this.creatorUsername}: ${classified.message}`);

      const finalStatus = classified.kind === 'offline' ? 'ended' : 'failed';
      await this.teardownUpstream();
      this.transitionTo(finalStatus, classified.message);

      return { success: false, status: finalStatus, error: classified.message };
    }
  }

  public async disconnect(reason: string = 'STOPPED_BY_USER'): Promise<void> {
    this.isExplicitlyStopped = true;
    this.clearReconnectTimer();
    await this.teardownUpstream();
    this.transitionTo('disconnected', reason);
  }

  private async createUpstreamConnection(options: ConnectorOptions): Promise<any> {
    let mod: any;
    try {
      mod = await import('tiktok-live-connector');
    } catch {
      throw new Error(
        'tiktok-live-connector package is not installed. Install it or use MockConnector (TIKTOK_CONNECTOR_MODE=mock).'
      );
    }

    const TikTokLiveConnection = mod.TikTokLiveConnection || mod.default?.TikTokLiveConnection;
    if (!TikTokLiveConnection) {
      throw new Error('tiktok-live-connector v2+ is required (TikTokLiveConnection export not found)');
    }

    return new TikTokLiveConnection(this.creatorUsername, {
      processInitialData: false,
      enableExtendedGiftInfo:
        options.enableExtendedGiftInfo ?? process.env.TIKTOK_EXTENDED_GIFT_INFO === 'true',
      signApiKey: process.env.TIKTOK_SIGN_API_KEY || undefined,
    });
  }

  private async teardownUpstream(): Promise<void> {
    const connection = this.liveConnection;
    if (!connection) return;
    this.liveConnection = null;
    try {
      connection.removeAllListeners();
      await connection.disconnect();
    } catch (err: any) {
      this.safeLog('warn', `Error during upstream disconnect: ${err.message}`);
    }
  }

  private bindUpstreamEvents(): void {
    const connection = this.liveConnection;
    if (!connection) return;

    connection.on('member', (raw: any) => {
      this.handleIncomingRawEvent('member', raw, {
        joinMethod: raw?.actionDescription || 'enter_room',
        memberCount: raw?.memberCount !== undefined ? Number(raw.memberCount) : null,
      });
    });

    connection.on('chat', (raw: any) => {
      // proto v3 carries the text in `content`; v1 used `comment`
      const text = String(raw?.content ?? raw?.comment ?? '');
      if (!text) return;
      this.handleIncomingRawEvent('chat', raw, {
        comment: text,
        text,
        messageId: raw?.common?.msgId ? String(raw.common.msgId) : null,
        language: raw?.contentLanguage || null,
      });
    });

    connection.on('gift', (raw: any) => {
      const payload = mapGiftPayload(raw);
      if (payload) this.handleIncomingRawEvent('gift', raw, payload);
    });

    // proto v3 like: `count` taps in this batch, `total` room-wide likes (string)
    connection.on('like', (raw: any) => {
      const total = raw?.total ?? raw?.totalLikeCount;
      this.handleIncomingRawEvent('like', raw, {
        likeCount: Number(raw?.count ?? raw?.likeCount ?? 1) || 1,
        totalLikes: total !== undefined && total !== '' ? Number(total) : null,
      });
    });

    connection.on('follow', (raw: any) => {
      this.handleIncomingRawEvent('follow', raw, { followType: 'live_follow' });
    });

    connection.on('share', (raw: any) => {
      this.handleIncomingRawEvent('share', raw, {
        shareType: raw?.shareType || 'social_share',
        shareTarget: raw?.shareTarget || 'unknown',
      });
    });

    // Viewer statistics: `total` is current viewers, `totalUser` is cumulative (user: null)
    connection.on('roomUser', (raw: any) => {
      const viewerCount = Number(raw?.total ?? raw?.viewerCount ?? 0);
      if (this.roomInfo) this.roomInfo.viewerCount = viewerCount;
      this.handleIncomingRawEvent('roomUser', raw, {
        viewerCount,
        totalViewers: raw?.totalUser !== undefined ? Number(raw.totalUser) : null,
      });
    });

    connection.on('streamEnd', () => {
      this.safeLog('info', `Stream ended by creator @${this.creatorUsername}`);
      this.transitionTo('ended', 'LIVE_ENDED_BY_CREATOR');
      void this.teardownUpstream();
    });

    connection.on('disconnected', (info: any) => {
      if (this.isExplicitlyStopped || this.status !== 'connected') return;
      this.safeLog(
        'warn',
        `Upstream socket closed for @${this.creatorUsername} (code ${info?.code ?? 'n/a'}). Reconnecting.`
      );
      void this.handleReconnection();
    });

    // Upstream 'error' covers per-message decode failures; it is not fatal
    connection.on('error', (err: any) => {
      const message = err?.exception?.message || err?.info || err?.message || 'Unknown upstream error';
      this.safeLog('warn', `Upstream connector error: ${message}`);
      this.safeEmit('error', { code: 'UPSTREAM_CONNECTOR_ERROR', message });
    });
  }

  private handleIncomingRawEvent(eventType: EventType, raw: any, payload: any): void {
    // Messages can arrive before connect() resolves; only drop them once terminal
    if (!this.options || ['disconnected', 'ended', 'failed'].includes(this.status)) return;

    // STRICT RULE: roomUser always has user: null
    const normalizedUser =
      eventType === 'roomUser'
        ? null
        : this.normalizationService.normalizeUserFromEvent(raw, eventType);

    const msgId = raw?.common?.msgId;
    const createTime = Number(raw?.common?.createTime);

    const canonicalEvent: CanonicalEvent = {
      ...(msgId ? { id: String(msgId) } : {}),
      tenantId: this.options.tenantId,
      sessionId: this.options.sessionId,
      eventType,
      eventTimestamp: createTime > 0 ? new Date(createTime) : new Date(),
      user: normalizedUser,
      payload,
      source: {
        connector: 'tiktok-live-connector',
        connectorVersion: '2.x',
      },
    };

    this.safeEmit(eventType, canonicalEvent);
  }

  /**
   * Bounded exponential backoff. Re-runs connect() on the same upstream instance
   * (v2 has no reconnect()). Non-retryable failures end the loop immediately.
   */
  private async handleReconnection(): Promise<void> {
    if (this.isExplicitlyStopped) return;
    if (this.status !== 'reconnecting' && !this.transitionTo('reconnecting', 'NETWORK_DISCONNECT')) return;

    if (this.reconnectAttempts >= this.maxRetries) {
      this.safeLog('error', `Max reconnection attempts (${this.maxRetries}) exhausted.`);
      this.transitionTo('failed', 'MAX_RETRIES_EXCEEDED');
      await this.teardownUpstream();
      return;
    }

    const delayMs = this.calculateBackoffDelay(this.reconnectAttempts);
    this.reconnectAttempts++;
    this.safeLog('info', `Reconnect attempt ${this.reconnectAttempts}/${this.maxRetries} in ${delayMs}ms`);
    this.safeEmit('reconnecting', { attempt: this.reconnectAttempts, delayMs });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(async () => {
      if (this.isExplicitlyStopped || this.status !== 'reconnecting' || !this.liveConnection) return;

      try {
        await this.liveConnection.connect();
        this.reconnectAttempts = 0;
        this.transitionTo('connected', 'RECONNECTED_SUCCESSFULLY');
      } catch (err: any) {
        const classified = classifyUpstreamError(err, this.creatorUsername);
        this.safeLog('warn', `Reconnect attempt ${this.reconnectAttempts} failed: ${classified.message}`);

        if (!classified.retryable) {
          const terminal = classified.kind === 'offline' ? 'ended' : 'failed';
          this.transitionTo(terminal, classified.message);
          await this.teardownUpstream();
          return;
        }
        void this.handleReconnection();
      }
    }, delayMs);
  }
}

/**
 * Maps a proto v3 WebcastGiftMessage to the canonical gift payload.
 * Combo-able gifts fire on every tap with repeatEnd=0, then once more with
 * repeatEnd=1 and the settled repeatCount; only that final message is kept so
 * each gift is persisted exactly once.
 */
export function mapGiftPayload(raw: any): Record<string, any> | null {
  const gift = raw?.gift ?? {};
  const extended = raw?.extendedGiftInfo ?? {};
  const giftType = gift.type ?? extended.type;
  const isComboGift = Number(giftType) === 1 || gift.combo === true;

  if (isComboGift && !Number(raw?.repeatEnd)) return null;

  const diamondCount = gift.diamondCount ?? extended.diamond_count;
  const repeatCount = Math.max(1, Number(raw?.repeatCount) || 1);
  const unitDiamonds = diamondCount !== undefined ? Number(diamondCount) : null;

  return {
    giftId: String(raw?.giftId || gift.id || 'unknown'),
    giftName: gift.name || extended.name || 'Unknown Gift',
    diamondCount: unitDiamonds,
    repeatCount,
    totalDiamonds: unitDiamonds !== null ? unitDiamonds * repeatCount : null,
    repeatEnd: true,
    giftType: giftType !== undefined ? Number(giftType) : null,
    groupId: raw?.groupId ? String(raw.groupId) : null,
    giftImageUrl: gift.image?.urlList?.[0] || extended.image?.url_list?.[0] || null,
    toUserId: raw?.toUser?.id ? String(raw.toUser.id) : null,
  };
}
