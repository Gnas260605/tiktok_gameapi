import { PrismaClient, GameEvent, GameEventType } from '@prisma/client';
import { BaseRepository } from '../base.repository';

export interface CreateGameEventDto {
  liveSessionId?: string | null;
  playerId?: string | null;
  eventType: GameEventType;
  payload: Record<string, any>;
}

export class GameEventRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Insert a new monotonic game event. Supports both (tenantId, data) and ({ tenantId, ...data }).
   */
  async createEvent(
    tenantIdOrData: string | (CreateGameEventDto & { tenantId: string }),
    data?: CreateGameEventDto
  ): Promise<GameEvent> {
    const tenantId = typeof tenantIdOrData === 'string' ? tenantIdOrData : tenantIdOrData.tenantId;
    const eventData = typeof tenantIdOrData === 'string' ? data! : tenantIdOrData;

    return this.prisma.gameEvent.create({
      data: {
        tenantId,
        liveSessionId: eventData.liveSessionId ?? null,
        playerId: eventData.playerId ?? null,
        eventType: eventData.eventType,
        payload: eventData.payload,
      },
    });
  }

  /**
   * Get events after a given sequence number (for realtime resume).
   */
  async getEventsAfterSeq(
    tenantId: string,
    afterSeq: bigint,
    limit: number = 100
  ): Promise<GameEvent[]> {
    return this.prisma.gameEvent.findMany({
      where: {
        tenantId,
        seq: { gt: afterSeq },
      },
      orderBy: { seq: 'asc' },
      take: this.normalizeLimit(limit, 50, 200),
    });
  }

  /**
   * Get latest sequence number for a tenant.
   */
  async getLatestSeq(tenantId: string): Promise<bigint> {
    const latest = await this.prisma.gameEvent.findFirst({
      where: { tenantId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return latest?.seq ?? 0n;
  }
}
