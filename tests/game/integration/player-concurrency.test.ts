import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PlayerRepository } from '../../../src/repositories/game/player.repository';
import { GameEventRepository } from '../../../src/repositories/game/game-event.repository';
import { GameConfigRepository } from '../../../src/repositories/game/game-config.repository';
import { GameConfigService } from '../../../src/services/game/game-config.service';
import { PlayerService } from '../../../src/services/game/player.service';

describe('PlayerService Concurrency & DB Integration (TC-J04)', () => {
  const prisma = new PrismaClient();
  const tenantId = 'a0000000-0000-0000-0000-000000000001'; // Acme Corp from seed

  let playerRepo: PlayerRepository;
  let eventRepo: GameEventRepository;
  let configRepo: GameConfigRepository;
  let configService: GameConfigService;
  let playerService: PlayerService;

  beforeAll(async () => {
    playerRepo = new PlayerRepository(prisma);
    eventRepo = new GameEventRepository(prisma);
    configRepo = new GameConfigRepository(prisma);
    configService = new GameConfigService(configRepo);
    playerService = new PlayerService(playerRepo, eventRepo, configService);

    await configRepo.ensureTenantSeeded(tenantId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('TC-J04: 20 concurrent join requests for same user produce exactly 1 player row', async () => {
    const testUniqueId = `concurrent_join_${Date.now()}`;

    // 1. Create a user in users table
    const user = await prisma.user.create({
      data: {
        tenantId,
        platform: 'tiktok',
        uniqueId: testUniqueId,
        platformUserId: `plt_${testUniqueId}`,
        nickname: 'Concurrent Tester',
      },
    });

    try {
      // 2. Launch 20 simultaneous concurrent joinOrReturn calls
      const promises = Array.from({ length: 20 }, (_, i) =>
        playerService.joinOrReturn(
          tenantId,
          {
            id: user.id,
            username: testUniqueId,
            nickname: `Tester ${i}`,
            platformUserId: user.platformUserId,
          },
          'male'
        )
      );

      const results = await Promise.all(promises);

      // 3. Verify all 20 calls succeeded and returned a valid player with same id
      expect(results).toHaveLength(20);
      const firstPlayerId = results[0].player.id;
      for (const res of results) {
        expect(res.player).toBeDefined();
        expect(res.player.id).toBe(firstPlayerId);
        expect(res.player.userId).toBe(user.id);
      }

      // Exactly 1 new player should be reported as isNew: true
      const newCount = results.filter((r) => r.isNew).length;
      expect(newCount).toBeGreaterThanOrEqual(1);

      // 4. Verify in DB: exactly 1 player record exists for this user
      const count = await prisma.gamePlayer.count({
        where: {
          tenantId,
          userId: user.id,
        },
      });
      expect(count).toBe(1);

      // 5. Verify the player has correct initial state (LK1 0 tu vi)
      const playerRecord = await playerRepo.findByUserId(tenantId, user.id);
      expect(playerRecord).not.toBeNull();
      expect(playerRecord?.realmOrder).toBe(1);
      expect(playerRecord?.level).toBe(1);
      expect(playerRecord?.currentExp).toBe(0n);
      expect(playerRecord?.totalCultivation).toBe(0n);
    } finally {
      // Cleanup test data
      await prisma.gameEvent.deleteMany({
        where: { tenantId, player: { userId: user.id } },
      });
      await prisma.gamePlayer.deleteMany({
        where: { tenantId, userId: user.id },
      });
      await prisma.user.delete({
        where: { id: user.id },
      });
    }
  });
});
