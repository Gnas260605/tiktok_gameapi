import { GamePlayer, PlayerGender } from '@prisma/client';
import { PlayerRepository } from '../../repositories/game/player.repository';
import { GameEventRepository } from '../../repositories/game/game-event.repository';
import { GameConfigService } from './game-config.service';
import { isMaxLevel } from './cultivation-engine';

export interface UserInput {
  id: string;
  username: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  platformUserId?: string | null;
}

export interface PlayerProfile {
  id: string;
  tenantId: string;
  userId: string;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  gender: PlayerGender;
  realmOrder: number;
  realmName: string;
  level: number;
  isMaxLevel: boolean;
  currentExp: bigint;
  requiredExp: bigint;
  totalCultivation: bigint;
  totalDiamondsGifted: bigint;
  breakthroughSuccessCount: number;
  breakthroughFailCount: number;
  breakthroughCooldownUntil: Date | null;
  characterAsset: string;
  status: string;
  version: number;
  joinedAt: Date;
  lastActiveAt: Date;
}

export class PlayerServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'BAD_REQUEST',
    public readonly details?: any
  ) {
    super(message);
    this.name = 'PlayerServiceError';
  }
}

export class PlayerService {
  constructor(
    private readonly playerRepo: PlayerRepository,
    private readonly eventRepo: GameEventRepository,
    private readonly configService: GameConfigService
  ) {}

  /**
   * Handle player join or return when viewer types `thamgia` or gifts.
   */
  async joinOrReturn(
    tenantId: string,
    user: UserInput,
    genderChoice?: PlayerGender,
    liveSessionId?: string | null
  ): Promise<{ player: GamePlayer; isNew: boolean }> {
    // 1. Look up existing player
    let player = await this.playerRepo.findByUserId(tenantId, user.id);

    if (player) {
      // Returning player
      const updates: any = { lastActiveAt: new Date() };
      let changed = false;

      // Handle rename / profile update
      if (user.username && user.username !== player.username) {
        updates.username = user.username;
        changed = true;
      }
      if (user.nickname !== undefined && user.nickname !== player.nickname) {
        updates.nickname = user.nickname;
        changed = true;
      }
      if (user.avatarUrl !== undefined && user.avatarUrl !== player.avatarUrl) {
        updates.avatarUrl = user.avatarUrl;
        changed = true;
      }

      if (changed) {
        player = await this.playerRepo.updatePlayer(tenantId, player.id, updates);
      } else {
        await this.playerRepo.updatePlayer(tenantId, player.id, updates);
      }

      // Record player_returned event
      await this.eventRepo.createEvent(tenantId, {
        liveSessionId,
        playerId: player.id,
        eventType: 'player_returned',
        payload: {
          playerId: player.id,
          username: player.username,
          nickname: player.nickname,
          realmOrder: player.realmOrder,
          level: player.level,
        },
      });

      return { player, isNew: false };
    }

    // 2. New player: determine gender
    const config = await this.configService.getConfig(tenantId);
    const assignedGender: PlayerGender =
      genderChoice === 'male' || genderChoice === 'female'
        ? genderChoice
        : (config.values.defaultGender as PlayerGender) || 'male';

    // 3. Create player (handles concurrent collision safely via unique tenant_id, user_id)
    player = await this.playerRepo.createPlayer(tenantId, {
      userId: user.id,
      tiktokUserId: user.platformUserId ?? null,
      username: user.username,
      nickname: user.nickname ?? null,
      avatarUrl: user.avatarUrl ?? null,
      gender: assignedGender,
      realmOrder: 1,
      level: 1,
      currentExp: 0n,
    });

    // Record player_joined event
    await this.eventRepo.createEvent(tenantId, {
      liveSessionId,
      playerId: player.id,
      eventType: 'player_joined',
      payload: {
        playerId: player.id,
        username: player.username,
        nickname: player.nickname,
        gender: player.gender,
        realmOrder: 1,
        level: 1,
      },
    });

    return { player, isNew: true };
  }

  /**
   * Change player gender (subject to 24h cooldown per TC-J08).
   */
  async changeGender(
    tenantId: string,
    playerId: string,
    newGender: PlayerGender
  ): Promise<{ success: boolean; player?: GamePlayer; reason?: string }> {
    const player = await this.playerRepo.findById(tenantId, playerId);
    if (!player) {
      throw new PlayerServiceError('Player not found', 404, 'PLAYER_NOT_FOUND');
    }

    if (player.gender === newGender) {
      return { success: true, player };
    }

    // Check 24-hour cooldown
    if (player.genderChangedAt) {
      const cooldownMs = 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - new Date(player.genderChangedAt).getTime();
      if (elapsed < cooldownMs) {
        return {
          success: false,
          player,
          reason: 'GENDER_COOLDOWN_ACTIVE',
        };
      }
    }

    const updated = await this.playerRepo.updatePlayer(tenantId, playerId, {
      gender: newGender,
      genderChangedAt: new Date(),
    });

    return { success: true, player: updated };
  }

  /**
   * Find player by id.
   */
  async getPlayer(tenantId: string, playerId: string): Promise<GamePlayer | null> {
    return this.playerRepo.findById(tenantId, playerId);
  }

  /**
   * Find player by userId.
   */
  async getPlayerByUserId(tenantId: string, userId: string): Promise<GamePlayer | null> {
    return this.playerRepo.findByUserId(tenantId, userId);
  }

  /**
   * Get full player profile with enriched realm and level attributes.
   */
  async getPlayerProfile(tenantId: string, playerId: string): Promise<PlayerProfile | null> {
    const player = await this.playerRepo.findById(tenantId, playerId);
    if (!player) return null;

    const [realms, levelTable] = await Promise.all([
      this.configService.getRealms(tenantId),
      this.configService.getLevelTable(tenantId),
    ]);

    const realm = realms.find((r) => r.realmOrder === player.realmOrder);
    const realmName = realm?.name ?? `Cảnh giới ${player.realmOrder}`;
    const characterAsset =
      player.gender === 'female'
        ? realm?.characterFemaleAsset ?? 'female_default.webp'
        : realm?.characterMaleAsset ?? 'male_default.webp';

    const requiredExp = levelTable.required(player.realmOrder, player.level);
    const maxLevel = isMaxLevel(
      {
        realmOrder: player.realmOrder,
        level: player.level,
        currentExp: player.currentExp,
      },
      levelTable
    );

    return {
      id: player.id,
      tenantId: player.tenantId,
      userId: player.userId,
      username: player.username,
      nickname: player.nickname,
      avatarUrl: player.avatarUrl,
      gender: player.gender,
      realmOrder: player.realmOrder,
      realmName,
      level: player.level,
      isMaxLevel: maxLevel,
      currentExp: player.currentExp,
      requiredExp,
      totalCultivation: player.totalCultivation,
      totalDiamondsGifted: player.totalDiamondsGifted,
      breakthroughSuccessCount: player.breakthroughSuccessCount,
      breakthroughFailCount: player.breakthroughFailCount,
      breakthroughCooldownUntil: player.breakthroughCooldownUntil,
      characterAsset,
      status: player.status,
      version: player.version,
      joinedAt: player.joinedAt,
      lastActiveAt: player.lastActiveAt,
    };
  }
}
