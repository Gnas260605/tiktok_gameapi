import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayerService, PlayerServiceError } from '../../../src/services/game/player.service';
import { PlayerRepository } from '../../../src/repositories/game/player.repository';
import { GameEventRepository } from '../../../src/repositories/game/game-event.repository';
import { GameConfigService } from '../../../src/services/game/game-config.service';

describe('PlayerService - Unit Tests', () => {
  let playerRepo: any;
  let eventRepo: any;
  let configService: any;
  let service: PlayerService;
  const tenantId = 'a0000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    playerRepo = {
      findById: vi.fn(),
      findByUserId: vi.fn(),
      findByUsername: vi.fn(),
      createPlayer: vi.fn(),
      updatePlayer: vi.fn(),
    };

    eventRepo = {
      createEvent: vi.fn().mockResolvedValue({ id: 'evt-1', seq: 1n }),
    };

    configService = {
      getConfig: vi.fn().mockResolvedValue({
        revision: 1,
        values: { defaultGender: 'male' },
      }),
      getRealms: vi.fn().mockResolvedValue([
        {
          realmOrder: 1,
          name: 'Luyện Khí',
          characterMaleAsset: 'luyen_khi_male.webp',
          characterFemaleAsset: 'luyen_khi_female.webp',
        },
      ]),
      getLevelTable: vi.fn().mockResolvedValue({
        required: vi.fn().mockReturnValue(1000n),
      }),
    };

    service = new PlayerService(
      playerRepo as unknown as PlayerRepository,
      eventRepo as unknown as GameEventRepository,
      configService as unknown as GameConfigService
    );
  });

  describe('TC-J01 & TC-J02: joinOrReturn', () => {
    it('TC-J01: creates new player with LK1 0 tu vi when user does not exist', async () => {
      playerRepo.findByUserId.mockResolvedValue(null);
      playerRepo.createPlayer.mockResolvedValue({
        id: 'player-1',
        tenantId,
        userId: 'user-1',
        username: 'nguoitu1',
        gender: 'female',
        realmOrder: 1,
        level: 1,
        currentExp: 0n,
        totalCultivation: 0n,
      });

      const res = await service.joinOrReturn(
        tenantId,
        { id: 'user-1', username: 'nguoitu1' },
        'female'
      );

      expect(res.isNew).toBe(true);
      expect(res.player.id).toBe('player-1');
      expect(playerRepo.createPlayer).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          userId: 'user-1',
          username: 'nguoitu1',
          gender: 'female',
          realmOrder: 1,
          level: 1,
          currentExp: 0n,
        })
      );
      expect(eventRepo.createEvent).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          eventType: 'player_joined',
          playerId: 'player-1',
        })
      );
    });

    it('TC-J02: returns existing player without creating duplicate row', async () => {
      const existingPlayer = {
        id: 'player-1',
        tenantId,
        userId: 'user-1',
        username: 'nguoitu1',
        nickname: 'Đạo Hữu',
        avatarUrl: null,
        realmOrder: 2,
        level: 4,
        currentExp: 1500n,
      };
      playerRepo.findByUserId.mockResolvedValue(existingPlayer);
      playerRepo.updatePlayer.mockResolvedValue(existingPlayer);

      const res = await service.joinOrReturn(
        tenantId,
        { id: 'user-1', username: 'nguoitu1' }
      );

      expect(res.isNew).toBe(false);
      expect(res.player.id).toBe('player-1');
      expect(playerRepo.createPlayer).not.toHaveBeenCalled();
      expect(eventRepo.createEvent).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          eventType: 'player_returned',
          playerId: 'player-1',
        })
      );
    });

    it('TC-J07: updates username if existing viewer changed handle', async () => {
      const existingPlayer = {
        id: 'player-1',
        tenantId,
        userId: 'user-1',
        username: 'old_handle',
        nickname: null,
        avatarUrl: null,
      };
      playerRepo.findByUserId.mockResolvedValue(existingPlayer);
      playerRepo.updatePlayer.mockResolvedValue({
        ...existingPlayer,
        username: 'new_handle',
      });

      const res = await service.joinOrReturn(
        tenantId,
        { id: 'user-1', username: 'new_handle' }
      );

      expect(res.isNew).toBe(false);
      expect(playerRepo.updatePlayer).toHaveBeenCalledWith(
        tenantId,
        'player-1',
        expect.objectContaining({ username: 'new_handle' })
      );
    });
  });

  describe('TC-J08: changeGender with 24h Cooldown', () => {
    it('changes gender when no previous gender change exists', async () => {
      const player = {
        id: 'player-1',
        tenantId,
        gender: 'male',
        genderChangedAt: null,
      };
      playerRepo.findById.mockResolvedValue(player);
      playerRepo.updatePlayer.mockResolvedValue({
        ...player,
        gender: 'female',
        genderChangedAt: new Date(),
      });

      const res = await service.changeGender(tenantId, 'player-1', 'female');
      expect(res.success).toBe(true);
      expect(playerRepo.updatePlayer).toHaveBeenCalledWith(
        tenantId,
        'player-1',
        expect.objectContaining({ gender: 'female' })
      );
    });

    it('returns success immediately if gender is already the requested gender', async () => {
      const player = {
        id: 'player-1',
        tenantId,
        gender: 'male',
        genderChangedAt: new Date(), // recent change
      };
      playerRepo.findById.mockResolvedValue(player);

      const res = await service.changeGender(tenantId, 'player-1', 'male');
      expect(res.success).toBe(true);
      expect(playerRepo.updatePlayer).not.toHaveBeenCalled();
    });

    it('TC-J08: rejects gender change if called twice within 24 hours', async () => {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000);
      const player = {
        id: 'player-1',
        tenantId,
        gender: 'female',
        genderChangedAt: oneHourAgo,
      };
      playerRepo.findById.mockResolvedValue(player);

      const res = await service.changeGender(tenantId, 'player-1', 'male');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('GENDER_COOLDOWN_ACTIVE');
      expect(playerRepo.updatePlayer).not.toHaveBeenCalled();
    });

    it('allows gender change if 25 hours have passed', async () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600 * 1000);
      const player = {
        id: 'player-1',
        tenantId,
        gender: 'female',
        genderChangedAt: twentyFiveHoursAgo,
      };
      playerRepo.findById.mockResolvedValue(player);
      playerRepo.updatePlayer.mockResolvedValue({
        ...player,
        gender: 'male',
        genderChangedAt: new Date(),
      });

      const res = await service.changeGender(tenantId, 'player-1', 'male');
      expect(res.success).toBe(true);
      expect(playerRepo.updatePlayer).toHaveBeenCalled();
    });

    it('throws 404 error if player does not exist', async () => {
      playerRepo.findById.mockResolvedValue(null);
      await expect(
        service.changeGender(tenantId, 'non-existent', 'female')
      ).rejects.toThrow(PlayerServiceError);
    });
  });

  describe('getPlayerProfile', () => {
    it('returns enriched player profile with realmName and assets', async () => {
      const player = {
        id: 'player-1',
        tenantId,
        userId: 'user-1',
        username: 'nguoitu1',
        nickname: 'Sư Huynh',
        avatarUrl: 'https://example.com/avatar.jpg',
        gender: 'male',
        realmOrder: 1,
        level: 1,
        currentExp: 500n,
        totalCultivation: 500n,
        totalDiamondsGifted: 50n,
        breakthroughSuccessCount: 0,
        breakthroughFailCount: 0,
        breakthroughCooldownUntil: null,
        status: 'active',
        version: 1,
        joinedAt: new Date(),
        lastActiveAt: new Date(),
      };
      playerRepo.findById.mockResolvedValue(player);

      const profile = await service.getPlayerProfile(tenantId, 'player-1');
      expect(profile).not.toBeNull();
      expect(profile?.realmName).toBe('Luyện Khí');
      expect(profile?.characterAsset).toBe('luyen_khi_male.webp');
      expect(profile?.requiredExp).toBe(1000n);
      expect(profile?.isMaxLevel).toBe(false);
    });
  });
});
