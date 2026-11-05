import {
  PrismaClient,
  BreakthroughSession,
  BreakthroughHistory,
  BreakthroughStatus,
  BreakthroughResult,
  BreakthroughTrigger,
} from '@prisma/client';
import { BaseRepository } from '../base.repository';

export interface CreateBreakthroughDto {
  playerId: string;
  liveSessionId?: string | null;
  sourceRealmOrder: number;
  targetRealmOrder: number;
  baseChanceBp: number;
  maxChanceBp?: number;
  bonusDiamonds?: bigint;
  giftBonusBp?: number;
  status?: BreakthroughStatus;
  configSnapshot?: Record<string, any>;
  trigger?: BreakthroughTrigger;
  requestKey?: string | null;
  requestHash?: string | null;
  startedAt?: Date;
  endsAt: Date;
}

export interface CreateHistoryDto {
  playerId: string;
  sessionId: string;
  result: BreakthroughResult;
  roll: number;
  finalChanceBp: number;
  cultivationPenalty: bigint;
  realmBefore: number;
  expBefore: bigint;
  realmAfter: number;
  expAfter: bigint;
}

export class BreakthroughRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Find breakthrough session by id, strictly scoped by tenantId.
   */
  async findById(tenantId: string, id: string): Promise<BreakthroughSession | null> {
    return this.prisma.breakthroughSession.findFirst({
      where: { id, tenantId },
    });
  }

  /**
   * Find active breakthrough session for a player ('preparing' or 'resolving').
   */
  async findActiveSessionByPlayer(
    tenantId: string,
    playerId: string
  ): Promise<BreakthroughSession | null> {
    return this.prisma.breakthroughSession.findFirst({
      where: {
        tenantId,
        playerId,
        status: { in: ['preparing', 'resolving'] },
      },
    });
  }

  /**
   * Count active sessions across a tenant ('preparing' or 'resolving').
   */
  async countActiveSessions(tenantId: string): Promise<number> {
    return this.prisma.breakthroughSession.count({
      where: {
        tenantId,
        status: { in: ['preparing', 'resolving'] },
      },
    });
  }

  /**
   * Create a new breakthrough session.
   */
  async createSession(tenantId: string, data: CreateBreakthroughDto): Promise<BreakthroughSession> {
    // If liveSessionId is not provided, look up or find the most recent active live_session for the tenant
    let liveSessionId = data.liveSessionId;
    if (!liveSessionId) {
      const activeSession = await this.prisma.liveSession.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      if (activeSession) {
        liveSessionId = activeSession.id;
      } else {
        // Fallback: create a default session record if none exists
        const fallback = await this.prisma.liveSession.create({
          data: {
            tenantId,
            creatorUsername: 'streamer',
            status: 'connected',
          },
        });
        liveSessionId = fallback.id;
      }
    }

    return this.prisma.breakthroughSession.create({
      data: {
        tenantId,
        playerId: data.playerId,
        liveSessionId,
        sourceRealmOrder: data.sourceRealmOrder,
        targetRealmOrder: data.targetRealmOrder,
        baseChanceBp: data.baseChanceBp,
        maxChanceBp: data.maxChanceBp ?? 9500,
        bonusDiamonds: data.bonusDiamonds ?? 0n,
        giftBonusBp: data.giftBonusBp ?? 0,
        status: data.status ?? 'preparing',
        configSnapshot: data.configSnapshot ?? {},
        trigger: data.trigger ?? 'chat',
        requestKey: data.requestKey ?? null,
        requestHash: data.requestHash ?? null,
        startedAt: data.startedAt ?? new Date(),
        endsAt: data.endsAt,
      },
    });
  }

  /**
   * Update session bonus diamonds and bonus chance.
   */
  async updateSessionBonus(
    tenantId: string,
    id: string,
    bonusDiamonds: bigint,
    giftBonusBp: number
  ): Promise<BreakthroughSession> {
    return this.prisma.breakthroughSession.update({
      where: { tenantId_id: { tenantId, id } },
      data: {
        bonusDiamonds,
        giftBonusBp,
      },
    });
  }

  /**
   * Atomic transition: UPDATE ... WHERE status = 'preparing' RETURNING ...
   * Guarantees that only ONE process/scheduler can resolve a session.
   */
  async resolveSessionAtomically(
    tenantId: string,
    id: string
  ): Promise<BreakthroughSession | null> {
    const updated = await this.prisma.breakthroughSession.updateMany({
      where: {
        id,
        tenantId,
        status: 'preparing',
      },
      data: {
        status: 'resolving',
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.findById(tenantId, id);
  }

  /**
   * Update session status, finalChanceBp, endedAt.
   */
  async updateSessionStatus(
    tenantId: string,
    id: string,
    status: BreakthroughStatus,
    finalChanceBp?: number | null,
    endedAt: Date = new Date()
  ): Promise<BreakthroughSession> {
    return this.prisma.breakthroughSession.update({
      where: { tenantId_id: { tenantId, id } },
      data: {
        status,
        finalChanceBp: finalChanceBp !== undefined ? finalChanceBp : undefined,
        endedAt,
      },
    });
  }

  /**
   * Record immutable breakthrough history. Supports both (tenantId, data) and ({ tenantId, ...data }).
   */
  async createHistory(
    tenantIdOrData: string | (CreateHistoryDto & { tenantId: string }),
    data?: CreateHistoryDto
  ): Promise<BreakthroughHistory> {
    const tenantId = typeof tenantIdOrData === 'string' ? tenantIdOrData : tenantIdOrData.tenantId;
    const historyData = typeof tenantIdOrData === 'string' ? data! : tenantIdOrData;

    return this.prisma.breakthroughHistory.create({
      data: {
        tenantId,
        playerId: historyData.playerId,
        sessionId: historyData.sessionId,
        result: historyData.result,
        roll: historyData.roll,
        finalChanceBp: historyData.finalChanceBp,
        cultivationPenalty: historyData.cultivationPenalty,
        realmBefore: historyData.realmBefore,
        expBefore: historyData.expBefore,
        realmAfter: historyData.realmAfter,
        expAfter: historyData.expAfter,
      },
    });
  }

  /**
   * Find all active preparing sessions across all tenants (for recovery on server restart).
   */
  async findActivePreparingSessions(): Promise<BreakthroughSession[]> {
    return this.prisma.breakthroughSession.findMany({
      where: { status: 'preparing' },
    });
  }

  /**
   * Find preparing sessions that are overdue (ends_at <= now).
   */
  async findDuePreparingSessions(now: Date = new Date()): Promise<BreakthroughSession[]> {
    return this.prisma.breakthroughSession.findMany({
      where: {
        status: 'preparing',
        endsAt: { lte: now },
      },
    });
  }
}
