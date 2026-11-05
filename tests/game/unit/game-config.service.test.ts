import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameConfigService, GameConfigError } from '../../../src/services/game/game-config.service';
import { GameConfigRepository } from '../../../src/repositories/game/game-config.repository';

describe('GameConfigService', () => {
  let mockRepo: any;
  let service: GameConfigService;
  const tenantId = 'a0000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockRepo = {
      ensureTenantSeeded: vi.fn().mockResolvedValue(undefined),
      getConfigs: vi.fn().mockResolvedValue([
        {
          tenantId,
          configKey: 'gameEnabled',
          configValue: true,
          revision: 2,
          updatedAt: new Date('2026-11-05T00:00:00Z'),
        },
        {
          tenantId,
          configKey: 'tuViMultiplier',
          configValue: 10,
          revision: 2,
          updatedAt: new Date('2026-11-05T00:00:00Z'),
        },
      ]),
      getRealms: vi.fn().mockResolvedValue([
        { realmOrder: 1, code: 'luyen_khi', name: 'Luyện Khí' },
        { realmOrder: 2, code: 'truc_co', name: 'Trúc Cơ' },
      ]),
      getLevels: vi.fn().mockResolvedValue([
        { realmOrder: 1, level: 1, requiredExp: 1000n },
        { realmOrder: 1, level: 2, requiredExp: 2000n },
      ]),
      updateConfigs: vi.fn().mockResolvedValue(undefined),
    };

    service = new GameConfigService(mockRepo as unknown as GameConfigRepository);
  });

  describe('getConfig and Caching', () => {
    it('loads configurations and populates defaults', async () => {
      const config = await service.getConfig(tenantId);
      expect(config.revision).toBe(2);
      expect(config.values.gameEnabled).toBe(true);
      expect(config.values.tuViMultiplier).toBe(10);
      expect(config.values.maxChanceBp).toBe(9500); // from defaults
      expect(mockRepo.ensureTenantSeeded).toHaveBeenCalledWith(tenantId);
      expect(mockRepo.getConfigs).toHaveBeenCalledWith(tenantId);
    });

    it('returns cached config on subsequent calls without querying DB', async () => {
      await service.getConfig(tenantId);
      expect(mockRepo.getConfigs).toHaveBeenCalledTimes(1);

      const cached = await service.getConfig(tenantId);
      expect(cached.revision).toBe(2);
      expect(mockRepo.getConfigs).toHaveBeenCalledTimes(1); // Still 1!
    });

    it('re-queries DB after invalidate(tenantId)', async () => {
      await service.getConfig(tenantId);
      expect(mockRepo.getConfigs).toHaveBeenCalledTimes(1);

      service.invalidate(tenantId);
      await service.getConfig(tenantId);
      expect(mockRepo.getConfigs).toHaveBeenCalledTimes(2);
    });
  });

  describe('getLevelTable and Realms', () => {
    it('returns LevelTable from cached level data', async () => {
      const table = await service.getLevelTable(tenantId);
      expect(table.required(1, 1)).toBe(1000n);
      expect(table.required(1, 2)).toBe(2000n);
      // Fallback for unlisted
      expect(table.required(2, 1)).toBe(2500n);
    });

    it('returns realms from cached realm data', async () => {
      const realms = await service.getRealms(tenantId);
      expect(realms).toHaveLength(2);
      expect(realms[0].code).toBe('luyen_khi');
    });
  });

  describe('updateConfig and Optimistic Locking', () => {
    it('successfully updates config with matching baseRevision', async () => {
      mockRepo.getConfigs.mockResolvedValueOnce([
        {
          tenantId,
          configKey: 'tuViMultiplier',
          configValue: 10,
          revision: 2,
          updatedAt: new Date(),
        },
      ]);

      // On second getConfigs call (after update)
      mockRepo.getConfigs.mockResolvedValueOnce([
        {
          tenantId,
          configKey: 'tuViMultiplier',
          configValue: 20,
          revision: 3,
          updatedAt: new Date(),
        },
      ]);

      const updated = await service.updateConfig(
        tenantId,
        2, // baseRevision
        { tuViMultiplier: 20 },
        'Buffing multiplier for weekend event',
        'api-key-1',
        'req-1'
      );

      expect(mockRepo.updateConfigs).toHaveBeenCalledWith(
        tenantId,
        { tuViMultiplier: 20 },
        3, // newRevision = baseRevision + 1
        expect.objectContaining({
          actorApiKeyId: 'api-key-1',
          reason: 'Buffing multiplier for weekend event',
          requestId: 'req-1',
        })
      );
      expect(updated.revision).toBe(3);
      expect(updated.values.tuViMultiplier).toBe(20);
    });

    it('rejects update with 409 when baseRevision does not match current revision', async () => {
      await expect(
        service.updateConfig(tenantId, 1, { tuViMultiplier: 20 }, 'test reason')
      ).rejects.toThrow(GameConfigError);

      try {
        await service.updateConfig(tenantId, 1, { tuViMultiplier: 20 }, 'test reason');
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe('REVISION_CONFLICT');
      }
    });

    it('rejects update when reason is missing or empty', async () => {
      await expect(
        service.updateConfig(tenantId, 2, { tuViMultiplier: 20 }, '')
      ).rejects.toThrow('Reason is required');
    });

    it('validates config value boundaries', async () => {
      // tuViMultiplier out of range
      await expect(
        service.updateConfig(tenantId, 2, { tuViMultiplier: 0 }, 'reason')
      ).rejects.toThrow('tuViMultiplier must be an integer between 1 and 1000');

      await expect(
        service.updateConfig(tenantId, 2, { tuViMultiplier: 1001 }, 'reason')
      ).rejects.toThrow('tuViMultiplier must be an integer between 1 and 1000');

      // maxChanceBp out of range
      await expect(
        service.updateConfig(tenantId, 2, { maxChanceBp: 12000 }, 'reason')
      ).rejects.toThrow('maxChanceBp must be an integer between 0 and 10000');

      // preparationSeconds out of range
      await expect(
        service.updateConfig(tenantId, 2, { preparationSeconds: 5 }, 'reason')
      ).rejects.toThrow('preparationSeconds must be an integer between 10 and 120');

      // failurePenaltyRatio out of range
      await expect(
        service.updateConfig(tenantId, 2, { failurePenaltyRatio: 1.5 }, 'reason')
      ).rejects.toThrow('failurePenaltyRatio must be a number between 0 and 1');

      // defaultGender invalid
      await expect(
        service.updateConfig(tenantId, 2, { defaultGender: 'other' as any }, 'reason')
      ).rejects.toThrow('defaultGender must be either male or female');
    });
  });
});
