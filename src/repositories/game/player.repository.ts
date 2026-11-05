import { PrismaClient, GamePlayer, PlayerGender, PlayerStatus } from '@prisma/client';
import { BaseRepository } from '../base.repository';
import { PaginatedResult } from '../types';

export interface CreatePlayerDto {
  userId: string;
  tiktokUserId?: string | null;
  username: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  gender?: PlayerGender;
  realmOrder?: number;
  level?: number;
  currentExp?: bigint;
}

export interface UpdatePlayerDto {
  username?: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  gender?: PlayerGender;
  genderChangedAt?: Date | null;
  realmOrder?: number;
  level?: number;
  currentExp?: bigint;
  totalCultivation?: bigint;
  totalDiamondsGifted?: bigint;
  breakthroughSuccessCount?: number;
  breakthroughFailCount?: number;
  breakthroughCooldownUntil?: Date | null;
  realmReachedAt?: Date;
  cultivationReachedAt?: Date;
  giftsReachedAt?: Date;
  status?: PlayerStatus;
  version?: number;
  lastActiveAt?: Date;
}

export class PlayerRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Find player by id, strictly scoped by tenantId.
   */
  async findById(tenantId: string, id: string): Promise<GamePlayer | null> {
    return this.prisma.gamePlayer.findFirst({
      where: {
        id,
        tenantId,
      },
    });
  }

  /**
   * Find player by userId, strictly scoped by tenantId.
   */
  async findByUserId(tenantId: string, userId: string): Promise<GamePlayer | null> {
    return this.prisma.gamePlayer.findFirst({
      where: {
        userId,
        tenantId,
      },
    });
  }

  /**
   * Find player by username, strictly scoped by tenantId.
   */
  async findByUsername(tenantId: string, username: string): Promise<GamePlayer | null> {
    return this.prisma.gamePlayer.findFirst({
      where: {
        tenantId,
        username: { equals: username, mode: 'insensitive' },
      },
    });
  }

  /**
   * Create a new player.
   * Handles concurrency collision gracefully (P2002 on unique tenant_id, user_id).
   */
  async createPlayer(tenantId: string, data: CreatePlayerDto): Promise<GamePlayer> {
    const now = new Date();
    try {
      return await this.prisma.gamePlayer.create({
        data: {
          tenantId,
          userId: data.userId,
          tiktokUserId: data.tiktokUserId ?? null,
          username: data.username,
          nickname: data.nickname ?? null,
          avatarUrl: data.avatarUrl ?? null,
          gender: data.gender ?? 'male',
          realmOrder: data.realmOrder ?? 1,
          level: data.level ?? 1,
          currentExp: data.currentExp ?? 0n,
          totalCultivation: data.currentExp ?? 0n,
          totalDiamondsGifted: 0n,
          breakthroughSuccessCount: 0,
          breakthroughFailCount: 0,
          status: 'active',
          version: 0,
          realmReachedAt: now,
          cultivationReachedAt: now,
          giftsReachedAt: now,
          joinedAt: now,
          lastActiveAt: now,
        },
      });
    } catch (err: any) {
      // Concurrency collision: another process created the player simultaneously
      const isConflict =
        err.code === 'P2002' ||
        err.code === 'P2034' ||
        err.message?.includes('deadlock') ||
        err.message?.includes('40P01');

      if (isConflict) {
        // Jitter wait 15-35ms
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 20));
        const existing = await this.findByUserId(tenantId, data.userId);
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Update an existing player with optimistic locking or direct update.
   */
  async updatePlayer(tenantId: string, id: string, data: UpdatePlayerDto): Promise<GamePlayer> {
    return this.prisma.gamePlayer.update({
      where: {
        tenantId_id: {
          tenantId,
          id,
        },
      },
      data: {
        ...data,
        version: data.version !== undefined ? data.version : { increment: 1 },
      },
    });
  }

  /**
   * List players for a tenant with cursor pagination and optional search.
   */
  async listPlayers(
    tenantId: string,
    query?: string,
    cursor?: string,
    limit?: number
  ): Promise<PaginatedResult<GamePlayer>> {
    const take = this.normalizeLimit(limit, 50, 100);
    const decodedCursor = this.decodeCursor(cursor);

    const where: any = { tenantId };
    if (query && query.trim().length > 0) {
      const q = query.trim();
      where.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        { nickname: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (decodedCursor) {
      where.OR = [
        { createdAt: { lt: new Date(decodedCursor.timestamp) } },
        {
          createdAt: new Date(decodedCursor.timestamp),
          id: { lt: decodedCursor.id },
        },
      ];
    }

    const items = await this.prisma.gamePlayer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = items.length > take;
    const records = hasMore ? items.slice(0, take) : items;

    let nextCursor: string | null = null;
    if (hasMore && records.length > 0) {
      const last = records[records.length - 1];
      nextCursor = this.encodeCursor(last.id, last.createdAt);
    }

    return {
      items: records,
      meta: {
        hasMore,
        nextCursor,
      },
    };
  }
}
