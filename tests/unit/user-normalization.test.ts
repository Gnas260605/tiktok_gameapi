import { describe, it, expect } from 'vitest';
import { UserNormalizationService } from '../../src/services/user/user-normalization.service';

describe('UserNormalizationService Unit Tests', () => {
  const service = new UserNormalizationService();

  it('normalizes username by stripping leading @, trimming, and lowercasing', () => {
    const raw = {
      uniqueId: '  @@@Awesome_Streamer_99  ',
      nickname: 'Awesome',
    };
    const user = service.normalizeUser(raw);
    expect(user?.uniqueId).toBe('awesome_streamer_99');
  });

  it('determines Tier 1 (platform_id) when platformUserId is provided', () => {
    const raw = {
      platformUserId: '10001001',
      uniqueId: 'streamer_1',
      nickname: 'Streamer One',
    };
    const user = service.normalizeUser(raw);
    expect(user?.identityQuality).toBe('platform_id');
    expect(user?.platformUserId).toBe('10001001');
  });

  it('determines Tier 2 (handle_fallback) when only uniqueId is provided', () => {
    const raw = {
      platformUserId: null,
      uniqueId: 'handle_only_user',
      nickname: 'Handle Only',
    };
    const user = service.normalizeUser(raw);
    expect(user?.identityQuality).toBe('handle_fallback');
    expect(user?.platformUserId).toBeNull();
    expect(user?.uniqueId).toBe('handle_only_user');
  });

  it('determines Tier 3 (event_only) when neither platformUserId nor uniqueId is provided', () => {
    const raw = {
      platformUserId: null,
      uniqueId: null,
      nickname: 'Anonymous Viewer',
      avatarUrl: 'https://example.com/avatar.jpg',
    };
    const user = service.normalizeUser(raw);
    expect(user?.identityQuality).toBe('event_only');
    expect(user?.uniqueId).toBeNull();
  });

  it('strictly returns null user for roomUser eventType', () => {
    const raw = {
      platformUserId: '10001001',
      uniqueId: 'viewer_in_room',
      nickname: 'Should be ignored',
    };
    const user = service.normalizeUser(raw, 'roomUser');
    expect(user).toBeNull();
  });

  it('validates HTTP/HTTPS avatar URLs and rejects non-HTTP schemes', () => {
    expect(service.sanitizeAvatarUrl('https://tiktokcdn.com/avatar.jpg')).toBe('https://tiktokcdn.com/avatar.jpg');
    expect(service.sanitizeAvatarUrl('http://tiktokcdn.com/avatar.jpg')).toBe('http://tiktokcdn.com/avatar.jpg');
    expect(service.sanitizeAvatarUrl('javascript:alert(1)')).toBeNull();
    expect(service.sanitizeAvatarUrl('data:image/png;base64,...')).toBeNull();
    expect(service.sanitizeAvatarUrl('')).toBeNull();
    expect(service.sanitizeAvatarUrl(null)).toBeNull();
  });

  it('provides fallback nickname when nickname is missing or empty', () => {
    expect(service.sanitizeNickname('', 'my_handle')).toBe('my_handle');
    expect(service.sanitizeNickname('   ', null)).toBe('TikTok Viewer');
    expect(service.sanitizeNickname('Valid Nickname', 'my_handle')).toBe('Valid Nickname');
  });
});
