import { v4 as uuidv4 } from 'uuid';
import { BaseConnector } from './base.connector';
import {
  ConnectorOptions,
  ConnectionResult,
  CanonicalEvent,
  NormalizedUser,
  MemberPayload,
  ChatPayload,
  GiftPayload,
  LikePayload,
  FollowPayload,
  SharePayload,
  RoomUserPayload,
  EventType,
} from './types';

/**
 * Fixture user profiles spanning all 3 identity quality tiers.
 */
export const FIXTURE_USERS = {
  TIER1_ALICE: {
    platform: 'tiktok' as const,
    platformUserId: '10001001',
    uniqueId: 'alice_wanderer',
    nickname: 'Alice in LiveLand',
    avatarUrl: 'https://p16-sign.tiktokcdn.com/tos-alisg-avt/alice.jpeg',
    verified: true,
    identityQuality: 'platform_id' as const,
  },
  TIER1_BOB: {
    platform: 'tiktok' as const,
    platformUserId: '10001002',
    uniqueId: 'bob_the_builder',
    nickname: 'Bob B.',
    avatarUrl: 'https://p16-sign.tiktokcdn.com/tos-alisg-avt/bob.jpeg',
    verified: false,
    identityQuality: 'platform_id' as const,
  },
  TIER2_CHARLIE: {
    platform: 'tiktok' as const,
    platformUserId: null,
    uniqueId: 'charlie_handle_only',
    nickname: 'Charlie Chaplin',
    avatarUrl: null,
    verified: false,
    identityQuality: 'handle_fallback' as const,
  },
  TIER3_ANONYMOUS: {
    platform: 'tiktok' as const,
    platformUserId: null,
    uniqueId: null,
    nickname: 'TikTok Viewer',
    avatarUrl: null,
    verified: false,
    identityQuality: 'event_only' as const,
  },
};

/**
 * Standard TikTok gift catalog entries with official diamond values.
 */
export const FIXTURE_GIFTS = [
  { giftId: '5655', giftName: 'Rose', diamondCount: 1 },
  { giftId: '5269', giftName: 'Doughnut', diamondCount: 30 },
  { giftId: '6059', giftName: 'Galaxy', diamondCount: 1000 },
  { giftId: '6267', giftName: 'Lion', diamondCount: 29999 },
];

export class MockConnector extends BaseConnector {
  private tickerTimer: NodeJS.Timeout | null = null;
  private currentViewerCount: number = 250;
  private totalLikesAccumulator: number = 1000;

  constructor() {
    super();
  }

  /**
   * Connects instantly offline (<20ms). Generates synthetic room metadata.
   */
  public async connect(
    creatorUsername: string,
    options?: ConnectorOptions
  ): Promise<ConnectionResult> {
    this.options = options ?? {
      sessionId: `mock_session_${uuidv4()}`,
      tenantId: `mock_tenant_${uuidv4()}`,
    };
    this.creatorUsername = this.normalizeCreatorUsername(creatorUsername);
    this.isExplicitlyStopped = false;
    this.reconnectAttempts = 0;

    this.transitionTo('connecting');

    // Simulate minimal asynchronous connection handshake (<10ms)
    await new Promise((resolve) => setTimeout(resolve, 5));

    if (this.isExplicitlyStopped) {
      this.transitionTo('disconnected', 'STOPPED_BEFORE_CONNECTED');
      return { success: false, status: 'disconnected', error: 'Stopped during connection' };
    }

    const mockRoomId = `mock_room_${this.creatorUsername}_${Date.now()}`;
    this.roomInfo = {
      roomId: mockRoomId,
      creatorUsername: this.creatorUsername,
      title: `LIVE with @${this.creatorUsername}`,
      viewerCount: this.currentViewerCount,
      startedAt: new Date(),
    };

    this.transitionTo('connected');

    // Start background ticker if configured
    if (this.options?.mockTickerIntervalMs && this.options.mockTickerIntervalMs > 0) {
      this.startTicker(this.options.mockTickerIntervalMs);
    }

    return {
      success: true,
      roomId: mockRoomId,
      status: 'connected',
    };
  }

  /**
   * Cleanly disconnects the mock session.
   */
  public async disconnect(reason: string = 'STOPPED_BY_USER'): Promise<void> {
    this.isExplicitlyStopped = true;
    this.stopTicker();
    this.clearReconnectTimer();
    this.transitionTo('disconnected', reason);
  }

  // =========================================================================
  // TEST AUTOMATION SIMULATION APIS
  // =========================================================================

  /**
   * Low-level generic event simulation.
   */
  public simulateCanonicalEvent<T = any>(
    type: EventType,
    payload: T,
    user: NormalizedUser | null = null,
    sourceEventId?: string
  ): CanonicalEvent<T> {
    const tenantId = this.options?.tenantId ?? 'default_tenant';
    const sessionId = this.options?.sessionId ?? 'default_session';

    // CRITICAL ENFORCEMENT: roomUser MUST always have user: null
    const enforcedUser = type === 'roomUser' ? null : user;

    const event: CanonicalEvent<T> = {
      id: sourceEventId || uuidv4(),
      tenantId,
      sessionId,
      eventType: type,
      eventTimestamp: new Date(),
      user: enforcedUser,
      payload,
      source: {
        connector: 'mock-connector',
        connectorVersion: '1.0.0',
      },
    };

    this.safeEmit(type, event);
    return event;
  }

  /**
   * Universal simulateEvent API supporting both signature styles:
   * 1. simulateEvent(paramsObject)
   * 2. simulateEvent(type, payload, user, sourceEventId)
   */
  public simulateEvent(
    typeOrParams: any,
    payload?: any,
    user?: any,
    sourceEventId?: string
  ): any {
    if (typeof typeOrParams === 'object' && typeOrParams !== null) {
      // Params object style: { type, eventType, user, data, payload, eventId, id }
      const rawType = typeOrParams.eventType || typeOrParams.type || 'chat';
      const rawPayload = typeOrParams.payload || typeOrParams.data || {};
      const rawUser = typeOrParams.user ?? null;
      const rawId = typeOrParams.id || typeOrParams.eventId;

      let normalizedUser: NormalizedUser | null = null;
      if (rawUser && rawType !== 'roomUser') {
        const quality = rawUser.platformUserId
          ? 'platform_id'
          : rawUser.uniqueId
          ? 'handle_fallback'
          : 'event_only';

        normalizedUser = {
          platform: 'tiktok',
          platformUserId: rawUser.platformUserId ?? null,
          uniqueId: rawUser.uniqueId ? String(rawUser.uniqueId).replace(/^@/, '').toLowerCase().trim() : null,
          nickname: rawUser.nickname ?? rawUser.uniqueId ?? 'TikTok Viewer',
          avatarUrl: rawUser.avatarUrl ?? null,
          verified: rawUser.verified ?? false,
          identityQuality: rawUser.identityQuality ?? quality,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          profileObservedAt: new Date(),
        };
      }

      return this.simulateCanonicalEvent(rawType, rawPayload, normalizedUser, rawId);
    }

    return this.simulateCanonicalEvent(typeOrParams, payload, user, sourceEventId);
  }

  /**
   * Simulates a 'member' (viewer join) event.
   */
  public simulateMember(
    customUser?: Partial<NormalizedUser>,
    joinMethod: string = 'enter_room'
  ): CanonicalEvent<MemberPayload> {
    const user: NormalizedUser = {
      ...FIXTURE_USERS.TIER1_ALICE,
      ...customUser,
    };
    return this.simulateCanonicalEvent<MemberPayload>('member', { joinMethod, sourceFields: {} }, user);
  }

  /**
   * Simulates a 'chat' (comment) event.
   */
  public simulateChat(
    comment: string,
    userOverrides?: Partial<NormalizedUser>,
    messageId?: string
  ): CanonicalEvent<ChatPayload> {
    const user: NormalizedUser = {
      ...FIXTURE_USERS.TIER1_BOB,
      ...userOverrides,
    };
    return this.simulateCanonicalEvent<ChatPayload>(
      'chat',
      {
        comment,
        text: comment,
        messageId: messageId ?? `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        emotes: [],
      },
      user
    );
  }

  /**
   * Simulates a 'gift' event with diamond and combo parameters.
   */
  public simulateGift(
    giftName: string = 'Rose',
    diamondCount?: number,
    repeatCount: number = 1,
    repeatEnd: boolean = true,
    userOverrides?: Partial<NormalizedUser>
  ): CanonicalEvent<GiftPayload> {
    const matchedGift = FIXTURE_GIFTS.find(
      (g) => g.giftName.toLowerCase() === giftName.toLowerCase()
    );
    const resolvedDiamondCount = diamondCount !== undefined ? diamondCount : (matchedGift?.diamondCount ?? 1);
    const resolvedGiftId = matchedGift?.giftId ?? '5655';

    const user: NormalizedUser = {
      ...FIXTURE_USERS.TIER1_ALICE,
      ...userOverrides,
    };

    return this.simulateCanonicalEvent<GiftPayload>(
      'gift',
      {
        giftId: resolvedGiftId,
        giftName,
        diamondCount: resolvedDiamondCount,
        repeatCount,
        repeatEnd,
        giftType: 1,
        groupId: `group_${Date.now()}`,
      },
      user
    );
  }

  /**
   * Simulates a 'like' (screen tap) event.
   */
  public simulateLike(
    likeCount: number = 5,
    totalLikes?: number,
    userOverrides?: Partial<NormalizedUser>
  ): CanonicalEvent<LikePayload> {
    this.totalLikesAccumulator += likeCount;
    const finalTotalLikes = totalLikes !== undefined ? totalLikes : this.totalLikesAccumulator;

    const user: NormalizedUser = {
      ...FIXTURE_USERS.TIER2_CHARLIE,
      ...userOverrides,
    };

    return this.simulateCanonicalEvent<LikePayload>(
      'like',
      {
        likeCount,
        totalLikes: finalTotalLikes,
      },
      user
    );
  }

  /**
   * Simulates a 'follow' event.
   */
  public simulateFollow(userOverrides?: Partial<NormalizedUser>): CanonicalEvent<FollowPayload> {
    const user: NormalizedUser = {
      ...FIXTURE_USERS.TIER1_ALICE,
      ...userOverrides,
    };
    return this.simulateCanonicalEvent<FollowPayload>('follow', { followType: 'live_follow' }, user);
  }

  /**
   * Simulates a 'share' event.
   */
  public simulateShare(
    shareType: string = 'whatsapp',
    shareTarget?: string,
    userOverrides?: Partial<NormalizedUser>
  ): CanonicalEvent<SharePayload> {
    const target = shareTarget ?? shareType;
    const user: NormalizedUser = {
      ...FIXTURE_USERS.TIER2_CHARLIE,
      ...userOverrides,
    };
    return this.simulateCanonicalEvent<SharePayload>(
      'share',
      {
        shareType,
        shareTarget: target,
      },
      user
    );
  }

  /**
   * Simulates a 'roomUser' viewer count pulse.
   * STRICTLY sets user: null.
   */
  public simulateRoomUser(viewerCount?: number): CanonicalEvent<RoomUserPayload> {
    if (viewerCount !== undefined) {
      this.currentViewerCount = viewerCount;
    }
    return this.simulateCanonicalEvent<RoomUserPayload>(
      'roomUser',
      { viewerCount: this.currentViewerCount },
      null // GUARANTEED NULL
    );
  }

  /**
   * Simulates unexpected disconnection (network drop).
   */
  public async simulateDisconnect(reason: string = 'NETWORK_TIMEOUT'): Promise<void> {
    this.stopTicker();
    if (reason === 'STOPPED_BY_USER' || reason === 'USER_DISCONNECT') {
      this.transitionTo('disconnected', reason);
    } else {
      this.transitionTo('reconnecting', reason);
    }
  }

  /**
   * Simulates reconnection attempt and recovery.
   */
  public async simulateReconnect(attempt?: number, delayMs?: number): Promise<ConnectionResult> {
    if (attempt !== undefined && attempt > 0) {
      this.safeLog('info', `Simulating reconnect attempt ${attempt} with delay ${delayMs ?? 0}ms`);
    }
    this.transitionTo('connected', 'RECONNECTED_SUCCESSFULLY');
    return {
      success: true,
      roomId: this.roomInfo?.roomId,
      status: 'connected',
    };
  }

  /**
   * Simulates stream termination by creator.
   */
  public simulateStreamEnd(): void {
    this.stopTicker();
    this.clearReconnectTimer();
    this.transitionTo('ended', 'LIVE_ENDED_BY_CREATOR');
  }

  /**
   * Simulates connector error emission.
   */
  public simulateError(error: Error | string): void {
    const errObj = typeof error === 'string' ? new Error(error) : error;
    this.safeEmit('error', {
      code: 'MOCK_SIMULATED_ERROR',
      message: errObj.message,
      details: errObj.stack,
    });
  }

  // =========================================================================
  // AUTOMATED BACKGROUND TICKER MODE
  // =========================================================================

  /**
   * Starts periodic realistic event emissions for demo, stress, or load testing.
   */
  public startTicker(intervalMs: number = 1000): void {
    this.stopTicker();
    this.tickerTimer = setInterval(() => {
      if (this.status !== 'connected') return;

      const roll = Math.random();
      if (roll < 0.45) {
        // 45%: Likes
        this.simulateLike(Math.floor(Math.random() * 10) + 1);
      } else if (roll < 0.75) {
        // 30%: Chat
        const comments = [
          'Hello from Paris!',
          'Great stream!! 🔥',
          'Love the music 🎵',
          'Let’s goooo!',
          'Where are you from?',
        ];
        const comment = comments[Math.floor(Math.random() * comments.length)];
        this.simulateChat(comment);
      } else if (roll < 0.85) {
        // 10%: Gift
        const gift = FIXTURE_GIFTS[Math.floor(Math.random() * FIXTURE_GIFTS.length)];
        this.simulateGift(gift.giftName, gift.diamondCount, 1);
      } else if (roll < 0.92) {
        // 7%: Member join
        this.simulateMember();
      } else if (roll < 0.96) {
        // 4%: Share
        this.simulateShare('whatsapp');
      } else if (roll < 0.98) {
        // 2%: Follow
        this.simulateFollow();
      } else {
        // 2%: RoomUser pulse
        this.currentViewerCount += Math.floor(Math.random() * 11) - 5;
        if (this.currentViewerCount < 10) this.currentViewerCount = 10;
        this.simulateRoomUser(this.currentViewerCount);
      }
    }, intervalMs);
  }

  /**
   * Stops active background ticker.
   */
  public stopTicker(): void {
    if (this.tickerTimer) {
      clearInterval(this.tickerTimer);
      this.tickerTimer = null;
    }
  }
}

// Re-export alias for test compatibility if needed
export { MockConnector as MockTikTokConnector };
