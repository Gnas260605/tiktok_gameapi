import { PrismaClient, GamePlayer } from '@prisma/client';

export type LeaderboardType = 'realm' | 'level' | 'cultivation' | 'breakthrough' | 'gifts';
export type LeaderboardBoard = LeaderboardType;
export type LeaderboardScope = 'all' | 'session';

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  realmOrder: number;
  level: number;
  value: string;
}

export interface LeaderboardResult {
  board: LeaderboardType;
  scope: LeaderboardScope;
  generatedAt: string;
  entries: LeaderboardEntry[];
}

export class LeaderboardError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'BAD_REQUEST'
  ) {
    super(message);
    this.name = 'LeaderboardError';
  }
}

interface CacheEntry {
  data: LeaderboardResult;
  expiresAt: number;
}

export class LeaderboardService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 2000; // 2 seconds per GDD §9

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get leaderboard with 2s cache. Supports both positional and options object parameters.
   */
  async getLeaderboard(
    tenantId: string,
    board: LeaderboardType,
    scopeOrOptions?:
      | LeaderboardScope
      | {
          scope?: LeaderboardScope;
          liveSessionId?: string | null;
          limit?: number;
        },
    liveSessionId?: string | null,
    limit: number = 50
  ): Promise<LeaderboardResult> {
    let scope: LeaderboardScope = 'all';
    let sessionId: string | null = liveSessionId ?? null;
    let maxLimit = limit;

    if (scopeOrOptions && typeof scopeOrOptions === 'object') {
      scope = scopeOrOptions.scope || 'all';
      sessionId = scopeOrOptions.liveSessionId ?? null;
      if (scopeOrOptions.limit !== undefined) maxLimit = scopeOrOptions.limit;
    } else if (typeof scopeOrOptions === 'string') {
      scope = scopeOrOptions;
    }

    if (scope === 'session' && (!sessionId || sessionId.trim().length === 0)) {
      throw new LeaderboardError(
        'liveSessionId is required when scope=session',
        400,
        'MISSING_SESSION_ID'
      );
    }

    const cacheKey = `${tenantId}:${board}:${scope}:${sessionId ?? 'all'}:${maxLimit}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    let entries: LeaderboardEntry[] = [];

    switch (board) {
      case 'realm':
        entries = await this.getRealmLeaderboard(tenantId, maxLimit);
        break;
      case 'level':
        entries = await this.getLevelLeaderboard(tenantId, maxLimit);
        break;
      case 'cultivation':
        entries = await this.getCultivationLeaderboard(tenantId, maxLimit);
        break;
      case 'breakthrough':
        entries = await this.getBreakthroughLeaderboard(tenantId, maxLimit);
        break;
      case 'gifts':
        entries =
          scope === 'session'
            ? await this.getSessionGiftsLeaderboard(tenantId, sessionId!, maxLimit)
            : await this.getAllGiftsLeaderboard(tenantId, maxLimit);
        break;
      default:
        throw new LeaderboardError(`Unknown leaderboard type: ${board}`, 400, 'INVALID_BOARD');
    }

    const result: LeaderboardResult = {
      board,
      scope,
      generatedAt: new Date().toISOString(),
      entries,
    };

    this.cache.set(cacheKey, {
      data: result,
      expiresAt: now + this.cacheTtlMs,
    });

    return result;
  }

  /**
   * Top Cảnh Giới: realm_order DESC, level DESC, current_exp DESC, realm_reached_at ASC
   */
  private async getRealmLeaderboard(tenantId: string, limit: number): Promise<LeaderboardEntry[]> {
    const players = await this.prisma.gamePlayer.findMany({
      where: { tenantId, status: 'active' },
      orderBy: [
        { realmOrder: 'desc' },
        { level: 'desc' },
        { currentExp: 'desc' },
        { realmReachedAt: 'asc' },
      ],
      take: Math.min(limit, 100),
    });

    return this.computeDenseRank(
      players,
      (p) => `${p.realmOrder}`,
      (p) => p.realmOrder.toString()
    );
  }

  /**
   * Top Tầng (Tổng Cấp): (realm_order - 1)*10 + level DESC, current_exp DESC, realm_reached_at ASC, id ASC
   */
  private async getLevelLeaderboard(tenantId: string, limit: number): Promise<LeaderboardEntry[]> {
    const players = await this.prisma.gamePlayer.findMany({
      where: { tenantId, status: 'active' },
      orderBy: [
        { realmOrder: 'desc' },
        { level: 'desc' },
        { currentExp: 'desc' },
        { realmReachedAt: 'asc' },
        { id: 'asc' },
      ],
      take: Math.min(limit, 100),
    });

    // Sort by total level = (realmOrder - 1) * 10 + level
    players.sort((a, b) => {
      const totalLevelA = (a.realmOrder - 1) * 10 + a.level;
      const totalLevelB = (b.realmOrder - 1) * 10 + b.level;
      if (totalLevelB !== totalLevelA) return totalLevelB - totalLevelA;
      if (b.currentExp !== a.currentExp) return b.currentExp > a.currentExp ? 1 : -1;
      const reachDiff = a.realmReachedAt.getTime() - b.realmReachedAt.getTime();
      if (reachDiff !== 0) return reachDiff;
      return a.id.localeCompare(b.id);
    });

    return this.computeDenseRank(
      players,
      (p) => `${(p.realmOrder - 1) * 10 + p.level}`,
      (p) => `${(p.realmOrder - 1) * 10 + p.level}`
    );
  }

  /**
   * Top Tu Vi: total_cultivation DESC, cultivation_reached_at ASC, id ASC
   */
  private async getCultivationLeaderboard(tenantId: string, limit: number): Promise<LeaderboardEntry[]> {
    const players = await this.prisma.gamePlayer.findMany({
      where: { tenantId, status: 'active' },
      orderBy: [
        { totalCultivation: 'desc' },
        { cultivationReachedAt: 'asc' },
        { id: 'asc' },
      ],
      take: Math.min(limit, 100),
    });

    return this.computeDenseRank(
      players,
      (p) => p.totalCultivation.toString(),
      (p) => p.totalCultivation.toString()
    );
  }

  /**
   * Top Độ Kiếp Thành Công: breakthrough_success_count DESC, realm_order DESC, realm_reached_at ASC, id ASC
   */
  private async getBreakthroughLeaderboard(tenantId: string, limit: number): Promise<LeaderboardEntry[]> {
    const players = await this.prisma.gamePlayer.findMany({
      where: { tenantId, status: 'active' },
      orderBy: [
        { breakthroughSuccessCount: 'desc' },
        { realmOrder: 'desc' },
        { realmReachedAt: 'asc' },
        { id: 'asc' },
      ],
      take: Math.min(limit, 100),
    });

    return this.computeDenseRank(
      players,
      (p) => `${p.breakthroughSuccessCount}`,
      (p) => `${p.breakthroughSuccessCount}`
    );
  }

  /**
   * Top Quà Tặng (Toàn Thời Gian): total_diamonds_gifted DESC, gifts_reached_at ASC, id ASC
   */
  private async getAllGiftsLeaderboard(tenantId: string, limit: number): Promise<LeaderboardEntry[]> {
    const players = await this.prisma.gamePlayer.findMany({
      where: { tenantId, status: 'active' },
      orderBy: [
        { totalDiamondsGifted: 'desc' },
        { giftsReachedAt: 'asc' },
        { id: 'asc' },
      ],
      take: Math.min(limit, 100),
    });

    return this.computeDenseRank(
      players,
      (p) => p.totalDiamondsGifted.toString(),
      (p) => p.totalDiamondsGifted.toString()
    );
  }

  /**
   * Top Quà Tặng theo Live Session: sum(total_diamonds) in gift_transactions for liveSessionId
   */
  private async getSessionGiftsLeaderboard(
    tenantId: string,
    liveSessionId: string,
    limit: number
  ): Promise<LeaderboardEntry[]> {
    const aggregates: Array<{ player_id: string; total: bigint }> = await this.prisma.$queryRaw`
      SELECT player_id, SUM(total_diamonds)::bigint as total
      FROM gift_transactions
      WHERE tenant_id = ${tenantId}::uuid
        AND live_session_id = ${liveSessionId}::uuid
        AND status = 'applied'
        AND player_id IS NOT NULL
      GROUP BY player_id
      ORDER BY total DESC
      LIMIT ${Math.min(limit, 100)}
    `;

    if (aggregates.length === 0) {
      return [];
    }

    const playerIds = aggregates.map((a) => a.player_id);
    const players = await this.prisma.gamePlayer.findMany({
      where: {
        tenantId,
        id: { in: playerIds },
      },
    });

    const playerMap = new Map<string, GamePlayer>();
    for (const p of players) {
      playerMap.set(p.id, p);
    }

    let currentRank = 0;
    let prevValue: string | null = null;
    const entries: LeaderboardEntry[] = [];

    for (const agg of aggregates) {
      const p = playerMap.get(agg.player_id);
      if (!p) continue;

      const valStr = agg.total.toString();
      if (prevValue === null || valStr !== prevValue) {
        currentRank += 1;
        prevValue = valStr;
      }

      entries.push({
        rank: currentRank,
        playerId: p.id,
        username: p.username,
        nickname: p.nickname,
        avatarUrl: p.avatarUrl,
        realmOrder: p.realmOrder,
        level: p.level,
        value: valStr,
      });
    }

    return entries;
  }

  /**
   * Helper to calculate dense rank over sorted players.
   */
  private computeDenseRank(
    players: GamePlayer[],
    rankKeyFn: (p: GamePlayer) => string,
    valueFn: (p: GamePlayer) => string
  ): LeaderboardEntry[] {
    let currentRank = 0;
    let prevRankKey: string | null = null;
    const entries: LeaderboardEntry[] = [];

    for (const p of players) {
      const rankKey = rankKeyFn(p);
      if (prevRankKey === null || rankKey !== prevRankKey) {
        currentRank += 1;
        prevRankKey = rankKey;
      }

      entries.push({
        rank: currentRank,
        playerId: p.id,
        username: p.username,
        nickname: p.nickname,
        avatarUrl: p.avatarUrl,
        realmOrder: p.realmOrder,
        level: p.level,
        value: valueFn(p),
      });
    }

    return entries;
  }

  /**
   * Invalidate cache for a tenant.
   */
  invalidate(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
