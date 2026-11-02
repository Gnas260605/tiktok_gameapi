import { PrismaClient, Event, User } from '@prisma/client';
import { BaseRepository } from './base.repository';
import {
  CreateEventDto,
  ListEventsFilter,
  CursorPagination,
  PaginatedResult,
} from './types';

export class EventRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Persist a canonical event.
   * Verifies session belongs to tenant prior to insertion.
   */
  async createEvent(tenantId: string, data: CreateEventDto): Promise<Event> {
    // Defense-in-depth: Verify session belongs to tenant
    const session = await this.prisma.liveSession.findFirst({
      where: {
        id: data.sessionId,
        tenantId,
      },
      select: { id: true },
    });

    if (!session) {
      throw new Error(`Session ${data.sessionId} does not belong to tenant ${tenantId}`);
    }

    // If userId supplied, verify user belongs to tenant
    if (data.userId) {
      const user = await this.prisma.user.findFirst({
        where: {
          id: data.userId,
          tenantId,
        },
        select: { id: true },
      });
      if (!user) {
        throw new Error(`User ${data.userId} does not belong to tenant ${tenantId}`);
      }
    }

    return this.prisma.event.create({
      data: {
        tenantId,
        sessionId: data.sessionId,
        userId: data.userId ?? null,
        eventType: data.eventType,
        occurredAt: data.occurredAt,
        receivedAt: data.receivedAt ?? new Date(),
        data: data.data,
        sourceEventId: data.sourceEventId ?? null,
        payloadFingerprint: data.payloadFingerprint ?? null,
        connectorName: data.connectorName ?? null,
        connectorVersion: data.connectorVersion ?? null,
      },
    });
  }

  /**
   * Find single event by ID strictly scoped to tenant.
   * Includes linked user snapshot if present.
   */
  async findById(tenantId: string, id: string): Promise<(Event & { user: User | null }) | null> {
    return this.prisma.event.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * List events for a specific live session. Strictly scoped to tenant.
   */
  async listBySession(
    tenantId: string,
    sessionId: string,
    pagination?: CursorPagination
  ): Promise<PaginatedResult<Event>> {
    return this.listByTenant(tenantId, { sessionId }, pagination);
  }

  /**
   * List events for a specific user. Strictly scoped to tenant.
   */
  async listByUser(
    tenantId: string,
    userId: string,
    pagination?: CursorPagination
  ): Promise<PaginatedResult<Event>> {
    return this.listByTenant(tenantId, { userId }, pagination);
  }

  /**
   * List events with multi-criteria filters (session, user, type, time window) and cursor pagination.
   */
  async listByTenant(
    tenantId: string,
    filters?: ListEventsFilter,
    pagination?: CursorPagination
  ): Promise<PaginatedResult<Event>> {
    const limit = this.normalizeLimit(pagination?.limit);
    const decoded = this.decodeCursor(pagination?.cursor);

    const where: any = {
      tenantId,
      ...(filters?.sessionId && { sessionId: filters.sessionId }),
      ...(filters?.userId && { userId: filters.userId }),
      ...(filters?.eventType && { eventType: filters.eventType }),
    };

    if (filters?.from || filters?.to) {
      where.receivedAt = {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      };
    }

    if (decoded) {
      where.OR = [
        { receivedAt: { lt: new Date(decoded.timestamp) } },
        {
          receivedAt: new Date(decoded.timestamp),
          id: { lt: decoded.id },
        },
      ];
    }

    const items = await this.prisma.event.findMany({
      where,
      take: limit + 1,
      orderBy: [
        { receivedAt: 'desc' },
        { id: 'desc' },
      ],
      include: {
        user: true,
      },
    });

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | null = null;
    if (hasMore && resultItems.length > 0) {
      const last = resultItems[resultItems.length - 1];
      nextCursor = this.encodeCursor(last.id, last.receivedAt);
    }

    return {
      items: resultItems,
      meta: {
        nextCursor,
        hasMore,
      },
    };
  }
}
