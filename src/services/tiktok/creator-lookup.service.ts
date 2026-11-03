import { classifyUpstreamError, UpstreamErrorKind } from '../../adapters/tiktok/upstream-errors';

export interface CreatorProfile {
  uniqueId: string;
  isLive: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  platformUserId: string | null;
  followerCount: number | null;
  roomId: string | null;
  title: string | null;
  viewerCount: number | null;
}

export class CreatorLookupError extends Error {
  constructor(public readonly kind: UpstreamErrorKind, message: string) {
    super(message);
    this.name = 'CreatorLookupError';
  }
}

export interface CreatorLookupOptions {
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxCacheEntries?: number;
}

// Webcast room status 2 = broadcasting
const ROOM_STATUS_LIVE = 2;

/**
 * Resolves a TikTok creator's display name, avatar and LIVE status. This needs
 * no sign-server key, unlike the event stream. The api-live route returns the
 * profile for offline creators too; the webcast room-info fallback only knows
 * the owner while LIVE, so there an offline creator has null profile fields.
 *
 * Results are cached briefly and concurrent lookups for the same user share one
 * upstream request, since the dashboard looks up on every keystroke pause and
 * TikTok throttles aggressive callers.
 */
export class CreatorLookupService {
  private readonly cache = new Map<string, { profile: CreatorProfile; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<CreatorProfile>>();
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly maxCacheEntries: number;

  constructor(options: CreatorLookupOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxCacheEntries = options.maxCacheEntries ?? 1_000;
  }

  public async lookup(rawUsername: string): Promise<CreatorProfile> {
    const uniqueId = rawUsername.trim().replace(/^@+/, '').toLowerCase();

    const cached = this.cache.get(uniqueId);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;

    const pending = this.inFlight.get(uniqueId);
    if (pending) return pending;

    const request = this.fetchProfile(uniqueId)
      .then((profile) => {
        this.remember(uniqueId, profile);
        return profile;
      })
      .finally(() => this.inFlight.delete(uniqueId));

    this.inFlight.set(uniqueId, request);
    return request;
  }

  private remember(uniqueId: string, profile: CreatorProfile): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(uniqueId, { profile, expiresAt: Date.now() + this.cacheTtlMs });
  }

  private async fetchProfile(uniqueId: string): Promise<CreatorProfile> {
    try {
      return await withTimeout(this.fetchFromUpstream(uniqueId), this.timeoutMs);
    } catch (err: any) {
      if (err instanceof CreatorLookupError) throw err;
      const classified = classifyUpstreamError(err, uniqueId);
      throw new CreatorLookupError(classified.kind, classified.message);
    }
  }

  private async fetchFromUpstream(uniqueId: string): Promise<CreatorProfile> {
    const mod: any = await import('tiktok-live-connector');
    const TikTokLiveConnection = mod.TikTokLiveConnection || mod.default?.TikTokLiveConnection;
    const connection = new TikTokLiveConnection(uniqueId, {});

    // Primary: one api-live/user/room request returns the profile even when the
    // creator is offline. fetchRoomId() would try a slow HTML scrape first.
    const RouteConfig = mod.RouteConfig || mod.default?.RouteConfig;
    if (RouteConfig?.fetchRoomInfoFromApiLive) {
      try {
        const response = await RouteConfig.fetchRoomInfoFromApiLive({
          webClient: connection.webClient,
          uniqueId,
        });
        return profileFromApiLive(uniqueId, response?.data);
      } catch {
        // fall through to the webcast room-info path
      }
    }

    const roomId = String(await connection.fetchRoomId());
    const info = await connection.fetchRoomInfo(roomId);
    const room = info?.data ?? {};
    const owner = room.owner;

    if (room.status !== ROOM_STATUS_LIVE || !owner) {
      return {
        uniqueId,
        isLive: false,
        nickname: null,
        avatarUrl: null,
        platformUserId: null,
        followerCount: null,
        roomId: null,
        title: null,
        viewerCount: null,
      };
    }

    return {
      uniqueId: String(owner.display_id || uniqueId).toLowerCase(),
      isLive: true,
      nickname: owner.nickname || null,
      avatarUrl: owner.avatar_thumb?.url_list?.[0] || owner.avatar_medium?.url_list?.[0] || null,
      platformUserId: owner.id_str || (owner.id ? String(owner.id) : null),
      followerCount: owner.follow_info?.follower_count ?? null,
      roomId,
      title: room.title || null,
      viewerCount: room.user_count ?? null,
    };
  }
}

function profileFromApiLive(uniqueId: string, data: any): CreatorProfile {
  const user = data?.user;
  if (!user?.uniqueId) {
    throw new CreatorLookupError('not_found', `TikTok user @${uniqueId} was not found`);
  }
  const liveRoom = data.liveRoom ?? {};
  const isLive = liveRoom.status === ROOM_STATUS_LIVE || user.status === ROOM_STATUS_LIVE;
  const avatar = user.avatarThumb || user.avatarMedium;

  return {
    uniqueId: String(user.uniqueId).toLowerCase(),
    isLive,
    nickname: user.nickname || null,
    avatarUrl: typeof avatar === 'string' && avatar.startsWith('http') ? avatar : null,
    platformUserId: user.id ? String(user.id) : null,
    followerCount: data.stats?.followerCount || null,
    roomId: isLive && user.roomId ? String(user.roomId) : null,
    title: isLive ? liveRoom.title || null : null,
    viewerCount: isLive ? liveRoom.liveRoomStats?.userCount ?? null : null,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CreatorLookupError('network', `TikTok lookup timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
