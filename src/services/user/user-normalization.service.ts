import { NormalizedUser, IdentityQuality, EventType } from '../../adapters/tiktok/types';

export class UserNormalizationService {
  /**
   * Normalizes an upstream or mock user object into a canonical NormalizedUser.
   * If rawUser is null/undefined or if eventType === 'roomUser', strictly returns null.
   */
  public normalizeUser(rawUser: any, eventType?: EventType): NormalizedUser | null {
    // CRITICAL INVARIANT: roomUser event NEVER has an associated user identity
    if (eventType === 'roomUser') {
      return null;
    }

    if (!rawUser) {
      return null;
    }

    // 1. Extract platform user ID (permanent numeric platform identifier)
    const platformUserId = this.extractPlatformUserId(rawUser);

    // 2. Extract and sanitize uniqueId (handle/username)
    const uniqueId = this.sanitizeUniqueId(rawUser.uniqueId || rawUser.displayId || rawUser.secUid);

    // 3. Extract and sanitize display nickname
    const nickname = this.sanitizeNickname(rawUser.nickname || rawUser.nickName, uniqueId);

    // 4. Extract and validate avatar URL
    const avatarUrl = this.sanitizeAvatarUrl(
      rawUser.avatarUrl ||
      rawUser.profilePictureUrl ||
      rawUser.avatarThumb?.url_list?.[0] ||
      rawUser.avatarThumb?.urlList?.[0] ||
      rawUser.avatarMedium?.url_list?.[0] ||
      rawUser.avatarMedium?.urlList?.[0]
    );

    // 5. Extract verification status
    const verified = typeof rawUser.verified === 'boolean' ? rawUser.verified : false;

    // 6. Determine 3-Tier Identity Quality Hierarchy
    // Tier 1: platform_id     -> platformUserId present
    // Tier 2: handle_fallback -> uniqueId present, no platformUserId
    // Tier 3: event_only      -> neither present
    let identityQuality: IdentityQuality = 'event_only';
    if (platformUserId) {
      identityQuality = 'platform_id';
    } else if (uniqueId) {
      identityQuality = 'handle_fallback';
    }

    // If explicit quality was already provided and valid, allow it unless higher quality exists
    if (rawUser.identityQuality) {
      if (rawUser.identityQuality === 'platform_id' && platformUserId) {
        identityQuality = 'platform_id';
      } else if (rawUser.identityQuality === 'handle_fallback' && !platformUserId && uniqueId) {
        identityQuality = 'handle_fallback';
      }
    }

    // If no meaningful user fields were provided at all, return null
    if (!platformUserId && !uniqueId && !nickname && !avatarUrl) {
      return null;
    }

    const now = new Date();
    return {
      platform: 'tiktok',
      platformUserId,
      uniqueId,
      nickname,
      avatarUrl,
      verified,
      identityQuality,
      firstSeenAt: rawUser.firstSeenAt ? new Date(rawUser.firstSeenAt) : now,
      lastSeenAt: rawUser.lastSeenAt ? new Date(rawUser.lastSeenAt) : now,
      profileObservedAt: rawUser.profileObservedAt ? new Date(rawUser.profileObservedAt) : now,
    };
  }

  /**
   * Helper extracting user object from raw event and normalizing.
   */
  public normalizeUserFromEvent(rawEvent: any, eventType?: EventType): NormalizedUser | null {
    if (!rawEvent) return null;
    if (eventType === 'roomUser' || rawEvent.eventType === 'roomUser' || rawEvent.type === 'roomUser') {
      return null;
    }

    const rawUser = rawEvent.user || rawEvent.sender || rawEvent;
    return this.normalizeUser(rawUser, eventType);
  }

  /**
   * Extracts permanent platform user ID from raw fields.
   */
  public extractPlatformUserId(raw: any): string | null {
    const rawId = raw.platformUserId || raw.userId || raw.uid || raw.id;
    if (rawId === null || rawId === undefined) return null;
    const str = String(rawId).trim();
    return str.length > 0 ? str : null;
  }

  /**
   * Sanitizes TikTok username handle: strips leading '@', lowercases, trims.
   */
  public sanitizeUniqueId(uniqueId: any): string | null {
    if (!uniqueId) return null;
    const str = String(uniqueId).trim().replace(/^@+/, '').toLowerCase();
    return str.length > 0 ? str : null;
  }

  /**
   * Sanitizes nickname with fallback to uniqueId or 'TikTok Viewer'.
   */
  public sanitizeNickname(nickname: any, uniqueIdFallback: string | null): string {
    if (nickname) {
      const trimmed = String(nickname).trim();
      if (trimmed.length > 0) return trimmed;
    }
    return uniqueIdFallback || 'TikTok Viewer';
  }

  /**
   * Validates and sanitizes avatar URLs. Enforces HTTP/HTTPS protocol.
   * Rejects javascript:, data:, file:, etc.
   */
  public sanitizeAvatarUrl(url: any): string | null {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return null;
    }
    return trimmed;
  }
}
