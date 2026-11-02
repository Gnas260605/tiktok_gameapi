import { PrismaClient, LiveSession } from '@prisma/client';
import { BaseRepository } from './base.repository';
import {
  CreateSessionDto,
  UpdateSessionDetailsDto,
  ListSessionsFilter,
  CursorPagination,
  PaginatedResult,
  SessionStatus,
} from './types';

const ACTIVE_STATUSES: SessionStatus[] = ['queued', 'connecting', 'connected', 'reconnecting'];

export class SessionRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Creates a new live session for a tenant.
   * Enforces lowercase normalized creatorUsername.
   */
  async create(tenantId: string, data: CreateSessionDto): Promise<LiveSession> {
    const normalizedUsername = data.creatorUsername.replace(/^@/, '').toLowerCase().trim();

    return this.prisma.liveSession.create({
      data: {
        tenantId,
        platform: data.platform ?? 'tiktok',
        creatorUsername: normalizedUsername,
        roomId: data.roomId ?? null,
        status: 'queued',
        connectorMetadata: data.connectorMetadata ?? {},
      },
    });
  }

  /**
   * Finds a session by ID strictly scoped to tenant.
   */
  async findById(tenantId: string, id: string): Promise<LiveSession | null> {
    return this.prisma.liveSession.findFirst({
      where: {
        id,
        tenantId,
      },
    });
  }

  /**
   * Check for an existing active session for creator within tenant.
   * Used to prevent duplicate active sessions (409 Conflict).
   */
  async findActiveByCreator(
    tenantId: string,
    platform: string,
    creatorUsername: string
  ): Promise<LiveSession | null> {
    const normalizedUsername = creatorUsername.replace(/^@/, '').toLowerCase().trim();

    return this.prisma.liveSession.findFirst({
      where: {
        tenantId,
        platform,
        creatorUsername: normalizedUsername,
        status: { in: ACTIVE_STATUSES },
      },
    });
  }

  /**
   * Updates session status and details strictly within tenant boundary.
   * Returns null if session does not belong to tenant.
   */
  async updateStatus(
    tenantId: string,
    id: string,
    status: SessionStatus,
    details?: UpdateSessionDetailsDto
  ): Promise<LiveSession | null> {
    const session = await this.findById(tenantId, id);
    if (!session) return null;

    const updateData: any = {
      status,
      ...(details?.disconnectReason !== undefined && { disconnectReason: details.disconnectReason }),
      ...(details?.roomId !== undefined && { roomId: details.roomId }),
      ...(details?.connectorMetadata !== undefined && { connectorMetadata: details.connectorMetadata }),
      ...(details?.startedAt !== undefined && { startedAt: details.startedAt }),
      ...(details?.endedAt !== undefined && { endedAt: details.endedAt }),
    };

    return this.prisma.liveSession.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Lists sessions with filters and cursor pagination. Strictly scoped to tenant.
   */
  async list(
    tenantId: string,
    filters?: ListSessionsFilter,
    pagination?: CursorPagination
  ): Promise<PaginatedResult<LiveSession>> {
    const limit = this.normalizeLimit(pagination?.limit);
    const decoded = this.decodeCursor(pagination?.cursor);

    const where: any = {
      tenantId,
      ...(filters?.status && { status: filters.status }),
      ...(filters?.platform && { platform: filters.platform }),
      ...(filters?.creatorUsername && {
        creatorUsername: filters.creatorUsername.replace(/^@/, '').toLowerCase().trim(),
      }),
    };

    if (decoded) {
      where.OR = [
        { createdAt: { lt: new Date(decoded.timestamp) } },
        {
          createdAt: new Date(decoded.timestamp),
          id: { lt: decoded.id },
        },
      ];
    }

    const items = await this.prisma.liveSession.findMany({
      where,
      take: limit + 1,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | null = null;
    if (hasMore && resultItems.length > 0) {
      const last = resultItems[resultItems.length - 1];
      nextCursor = this.encodeCursor(last.id, last.createdAt);
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
