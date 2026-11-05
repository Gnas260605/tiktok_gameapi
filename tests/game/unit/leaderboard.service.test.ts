import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LeaderboardService, LeaderboardError } from '../../../src/services/game/leaderboard.service';
import { PrismaClient } from '@prisma/client';

describe('LeaderboardService — Unit & Contract Tests (TC-R01 to TC-R04)', () => {
  const tenantId = 'a0000000-0000-0000-0000-000000000001';
  let mockPrisma: any;
  let service: LeaderboardService;

  beforeEach(() => {
    mockPrisma = {
      gamePlayer: {
        findMany: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };
    service = new LeaderboardService(mockPrisma as unknown as PrismaClient);
  });

  describe('TC-R04: Validation of scope=session without liveSessionId', () => {
    it('TC-R04: throws 400 MISSING_SESSION_ID when scope=session but liveSessionId is missing', async () => {
      await expect(
        service.getLeaderboard(tenantId, 'gifts', 'session')
      ).rejects.toThrow(LeaderboardError);

      try {
        await service.getLeaderboard(tenantId, 'gifts', 'session');
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('MISSING_SESSION_ID');
      }
    });
  });

  describe('TC-R02: Dense Rank and Secondary Sorting Tie-breaking', () => {
    it('TC-R02: assigns same dense rank for tied primary values, but sorts by reached_at asc', async () => {
      const earlierDate = new Date('2026-11-05T10:00:00Z');
      const laterDate = new Date('2026-11-05T11:00:00Z');

      const p1 = {
        id: 'player-1',
        tenantId,
        username: 'alice',
        nickname: null,
        avatarUrl: null,
        realmOrder: 3,
        level: 5,
        currentExp: 1000n,
        totalCultivation: 10000n,
        totalDiamondsGifted: 500n,
        breakthroughSuccessCount: 2,
        realmReachedAt: earlierDate,
        cultivationReachedAt: earlierDate,
        giftsReachedAt: earlierDate,
      };

      const p2 = {
        id: 'player-2',
        tenantId,
        username: 'bob',
        nickname: null,
        avatarUrl: null,
        realmOrder: 3,
        level: 5,
        currentExp: 1000n,
        totalCultivation: 10000n,
        totalDiamondsGifted: 500n,
        breakthroughSuccessCount: 2,
        realmReachedAt: laterDate, // Bob reached same realm later
        cultivationReachedAt: laterDate,
        giftsReachedAt: laterDate,
      };

      mockPrisma.gamePlayer.findMany.mockResolvedValue([p1, p2]);

      const res = await service.getLeaderboard(tenantId, 'cultivation', 'all');

      expect(res.entries).toHaveLength(2);
      // Both have totalCultivation = 10000 -> dense rank is 1 for both
      expect(res.entries[0].rank).toBe(1);
      expect(res.entries[1].rank).toBe(1);
      // Alice reached earlier -> sorted before Bob
      expect(res.entries[0].username).toBe('alice');
      expect(res.entries[1].username).toBe('bob');
    });
  });

  describe('TC-R03: Stability and 2s In-Memory Caching', () => {
    it('TC-R03: returns identical cached result across repeated calls without re-querying DB', async () => {
      const p1 = {
        id: 'player-1',
        tenantId,
        username: 'alice',
        nickname: null,
        avatarUrl: null,
        realmOrder: 2,
        level: 3,
        currentExp: 500n,
        totalCultivation: 5000n,
        totalDiamondsGifted: 100n,
        breakthroughSuccessCount: 1,
        realmReachedAt: new Date(),
        cultivationReachedAt: new Date(),
        giftsReachedAt: new Date(),
      };

      mockPrisma.gamePlayer.findMany.mockResolvedValue([p1]);

      const firstCall = await service.getLeaderboard(tenantId, 'realm');
      expect(mockPrisma.gamePlayer.findMany).toHaveBeenCalledTimes(1);

      // Repeat 100 times
      for (let i = 0; i < 100; i++) {
        const nextCall = await service.getLeaderboard(tenantId, 'realm');
        expect(nextCall.entries).toEqual(firstCall.entries);
      }

      // DB should still only have been queried once due to 2s cache
      expect(mockPrisma.gamePlayer.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('TC-R01: 5 Leaderboards Correct Query Structure', () => {
    it('queries correct fields for all 5 leaderboard types', async () => {
      mockPrisma.gamePlayer.findMany.mockResolvedValue([]);

      await service.getLeaderboard(tenantId, 'realm');
      expect(mockPrisma.gamePlayer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { realmOrder: 'desc' },
            { level: 'desc' },
            { currentExp: 'desc' },
            { realmReachedAt: 'asc' },
          ],
        })
      );

      service.invalidate(tenantId);
      await service.getLeaderboard(tenantId, 'cultivation');
      expect(mockPrisma.gamePlayer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { totalCultivation: 'desc' },
            { cultivationReachedAt: 'asc' },
            { id: 'asc' },
          ],
        })
      );

      service.invalidate(tenantId);
      await service.getLeaderboard(tenantId, 'breakthrough');
      expect(mockPrisma.gamePlayer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { breakthroughSuccessCount: 'desc' },
            { realmOrder: 'desc' },
            { realmReachedAt: 'asc' },
            { id: 'asc' },
          ],
        })
      );

      service.invalidate(tenantId);
      await service.getLeaderboard(tenantId, 'gifts', 'all');
      expect(mockPrisma.gamePlayer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { totalDiamondsGifted: 'desc' },
            { giftsReachedAt: 'asc' },
            { id: 'asc' },
          ],
        })
      );
    });
  });
});
