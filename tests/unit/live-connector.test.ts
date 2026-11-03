import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const upstream = vi.hoisted(() => ({
  instance: null as any,
  instances: 0,
  connectImpl: null as null | (() => Promise<any>),
  roomStatus: 2 as number | undefined,
  roomIdError: null as Error | null,
  apiLive: null as any,
}));

vi.mock('tiktok-live-connector', async () => {
  const { EventEmitter: Emitter } = await import('events');
  class TikTokLiveConnection extends Emitter {
    roomId = '7703767183207795477';
    connectCalls = 0;
    constructor(public uniqueId: string, public options: any) {
      super();
      upstream.instance = this;
      upstream.instances++;
    }
    async connect() {
      this.connectCalls++;
      if (upstream.connectImpl) return upstream.connectImpl();
      return { roomId: this.roomId, roomInfo: { data: { title: 'Sale', user_count: 9 } } };
    }
    async disconnect() {}
    async fetchRoomId() {
      if (upstream.roomIdError) throw upstream.roomIdError;
      return this.roomId;
    }
    async fetchRoomInfo() {
      if (upstream.roomStatus !== 2) return { data: { prompts: '' }, status_code: 4003110 };
      return {
        data: {
          status: 2,
          title: 'SAN SIEU SALE',
          user_count: 9,
          owner: {
            id_str: '7050143107078243329',
            display_id: 'anvatcomai.food',
            nickname: 'ĂN VẶT COMAI',
            avatar_thumb: { url_list: ['https://p16.tiktokcdn.com/avatar.webp'] },
            follow_info: { follower_count: 105255 },
          },
        },
      };
    }
  }
  const RouteConfig = {
    async fetchRoomInfoFromApiLive() {
      if (!upstream.apiLive) throw new Error('api-live blocked');
      return upstream.apiLive;
    },
  };
  return { TikTokLiveConnection, RouteConfig };
});

import { LiveTikTokConnector, mapGiftPayload } from '../../src/adapters/tiktok/live.connector';
import { classifyUpstreamError } from '../../src/adapters/tiktok/upstream-errors';
import {
  CreatorLookupService,
  CreatorLookupError,
} from '../../src/services/tiktok/creator-lookup.service';

// Shapes below are trimmed from real proto v3 messages captured from a LIVE room
const v3User = {
  id: '6544293809508581377',
  displayId: 'iloptiktok13',
  nickname: 'ANH THÍCH LỒNG ĐÈN 😊😇',
  avatarThumb: { urlList: ['https://p19-common-sign.tiktokcdn.com/avatar.webp'] },
};

function namedError(name: string, message: string): Error {
  const Ctor = { [name]: class extends Error {} }[name];
  return new Ctor(message);
}

describe('LiveTikTokConnector (proto v3 payloads)', () => {
  let connector: LiveTikTokConnector;
  let received: any[];

  beforeEach(async () => {
    upstream.connectImpl = null;
    received = [];
    connector = new LiveTikTokConnector();
    for (const type of ['chat', 'gift', 'member', 'like', 'follow', 'roomUser']) {
      (connector as unknown as EventEmitter).on(type, (e: any) => received.push(e));
    }
    const result = await connector.connect('anvatcomai.food', {
      tenantId: 't1',
      sessionId: 's1',
      initialReconnectDelayMs: 1,
      maxReconnectDelayMs: 1,
    });
    expect(result.success).toBe(true);
  });

  afterEach(async () => {
    await connector.disconnect();
  });

  it('does not request the Business-plan gift catalogue by default', () => {
    expect(upstream.instance.options.enableExtendedGiftInfo).toBe(false);
  });

  it('maps chat text from `content` and normalizes the v3 user', () => {
    upstream.instance.emit('chat', {
      common: { msgId: '7703848324673162005', createTime: '1793691975325' },
      user: v3User,
      content: 'Da mua',
      contentLanguage: 'vi',
    });

    expect(received).toHaveLength(1);
    const event = received[0];
    expect(event.id).toBe('7703848324673162005');
    expect(event.eventTimestamp.getTime()).toBe(1793691975325);
    expect(event.payload).toMatchObject({ comment: 'Da mua', text: 'Da mua', language: 'vi' });
    expect(event.user).toMatchObject({
      platformUserId: '6544293809508581377',
      uniqueId: 'iloptiktok13',
      nickname: 'ANH THÍCH LỒNG ĐÈN 😊😇',
      avatarUrl: 'https://p19-common-sign.tiktokcdn.com/avatar.webp',
      identityQuality: 'platform_id',
    });
  });

  it('maps likes from `count` / `total`', () => {
    upstream.instance.emit('like', { user: v3User, count: 15, total: '27602' });
    expect(received[0].payload).toEqual({ likeCount: 15, totalLikes: 27602 });
  });

  it('maps roomUser `total` to current viewers with no user identity', () => {
    upstream.instance.emit('roomUser', { total: '12', totalUser: '3800' });
    expect(received[0].user).toBeNull();
    expect(received[0].payload).toEqual({ viewerCount: 12, totalViewers: 3800 });
  });

  it('keeps only the settled event of a combo gift streak', () => {
    const gift = { id: '5655', name: 'Rose', diamondCount: 1, type: 1, combo: true, image: { urlList: ['https://x/rose.png'] } };
    upstream.instance.emit('gift', { common: { msgId: '201' }, user: v3User, giftId: '5655', repeatCount: 3, repeatEnd: 0, gift });
    upstream.instance.emit('gift', { common: { msgId: '202' }, user: v3User, giftId: '5655', repeatCount: 10, repeatEnd: 1, gift });

    expect(received).toHaveLength(1);
    expect(received[0].payload).toMatchObject({
      giftId: '5655',
      giftName: 'Rose',
      diamondCount: 1,
      repeatCount: 10,
      totalDiamonds: 10,
      giftImageUrl: 'https://x/rose.png',
    });
  });

  it('reconnects by re-running connect() after an upstream socket drop', async () => {
    const statuses: string[] = [];
    connector.on('statusChange', (s: any) => statuses.push(s.to));

    upstream.instance.emit('disconnected', { code: 1006 });
    await vi.waitFor(() => expect(connector.getStatus()).toBe('connected'));

    expect(statuses).toEqual(['reconnecting', 'connected']);
    expect(upstream.instance.connectCalls).toBe(2);
  });

  it('stops reconnecting when the creator went offline', async () => {
    upstream.connectImpl = () => Promise.reject(namedError('UserOfflineError', 'User is offline'));
    upstream.instance.emit('disconnected', { code: 1006 });

    await vi.waitFor(() => expect(connector.getStatus()).toBe('ended'));
    expect(upstream.instance.connectCalls).toBe(2);
  });
});

describe('mapGiftPayload', () => {
  it('emits non-combo gifts immediately', () => {
    expect(
      mapGiftPayload({ giftId: '6064', repeatCount: 1, repeatEnd: 0, gift: { name: 'Lion', diamondCount: 29999, type: 2 } })
    ).toMatchObject({ giftName: 'Lion', totalDiamonds: 29999 });
  });
});

describe('classifyUpstreamError', () => {
  it('treats sign rejections as non-retryable', () => {
    const result = classifyUpstreamError(
      namedError('SignatureMissingTokensError', 'Failed to sign a request: This endpoint requires a Business plan.'),
      'x'
    );
    expect(result).toMatchObject({ kind: 'sign_rejected', retryable: false });
  });

  it('treats sign rate limits as retryable', () => {
    expect(classifyUpstreamError(namedError('SignatureRateLimitError', 'Too many'), 'x')).toMatchObject({
      kind: 'rate_limited',
      retryable: true,
    });
  });

  it('maps unresolvable room ids to not_found', () => {
    expect(
      classifyUpstreamError(namedError('InvalidResponseCompositeError', 'Failed to retrieve Room ID from all sources.'), 'x').kind
    ).toBe('not_found');
  });
});

describe('CreatorLookupService', () => {
  beforeEach(() => {
    upstream.roomStatus = 2;
    upstream.roomIdError = null;
    upstream.apiLive = null;
  });

  it('resolves an offline creator profile from the api-live route', async () => {
    // Trimmed from a real api-live/user/room response for an offline creator
    upstream.apiLive = {
      data: {
        user: {
          id: '127905465618821121',
          uniqueId: 'khaby.lame',
          nickname: 'Khabane lame',
          avatarThumb: 'https://p19.tiktokcdn.com/khaby.webp',
          roomId: '7605806505484405535',
          status: 4,
        },
        liveRoom: { status: 4, title: '', liveRoomStats: { userCount: 0 } },
        stats: { followerCount: 0 },
      },
    };

    const profile = await new CreatorLookupService().lookup('khaby.lame');

    expect(profile).toEqual({
      uniqueId: 'khaby.lame',
      isLive: false,
      nickname: 'Khabane lame',
      avatarUrl: 'https://p19.tiktokcdn.com/khaby.webp',
      platformUserId: '127905465618821121',
      followerCount: null,
      roomId: null,
      title: null,
      viewerCount: null,
    });
  });

  it('reports LIVE stats from the api-live route', async () => {
    upstream.apiLive = {
      data: {
        user: { id: '7050143107078243329', uniqueId: 'anvatcomai.food', nickname: 'ĂN VẶT COMAI', avatarThumb: 'https://x/a.webp', roomId: '7703767183207795477', status: 2 },
        liveRoom: { status: 2, title: 'SAN SIEU SALE', liveRoomStats: { userCount: 9 } },
        stats: { followerCount: 105253 },
      },
    };

    const profile = await new CreatorLookupService().lookup('anvatcomai.food');
    expect(profile).toMatchObject({ isLive: true, roomId: '7703767183207795477', viewerCount: 9, followerCount: 105253 });
  });

  it('resolves nickname and avatar for a LIVE creator', async () => {
    const profile = await new CreatorLookupService().lookup('@AnVatComai.Food');

    expect(profile).toEqual({
      uniqueId: 'anvatcomai.food',
      isLive: true,
      nickname: 'ĂN VẶT COMAI',
      avatarUrl: 'https://p16.tiktokcdn.com/avatar.webp',
      platformUserId: '7050143107078243329',
      followerCount: 105255,
      roomId: '7703767183207795477',
      title: 'SAN SIEU SALE',
      viewerCount: 9,
    });
  });

  it('reports offline creators without profile fields', async () => {
    upstream.roomStatus = undefined;
    const profile = await new CreatorLookupService().lookup('khaby.lame');

    expect(profile.isLive).toBe(false);
    expect(profile.nickname).toBeNull();
  });

  it('caches results and shares concurrent upstream requests', async () => {
    const service = new CreatorLookupService();
    const before = upstream.instances;

    await Promise.all([service.lookup('anvatcomai.food'), service.lookup('anvatcomai.food')]);
    await service.lookup('@anvatcomai.food');

    expect(upstream.instances - before).toBe(1);
  });

  it('raises a not_found CreatorLookupError for unknown users', async () => {
    upstream.roomIdError = namedError('InvalidResponseCompositeError', 'Failed to retrieve Room ID from all sources.');

    await expect(new CreatorLookupService().lookup('no_such_user')).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(new CreatorLookupService().lookup('no_such_user')).rejects.toBeInstanceOf(CreatorLookupError);
  });
});
