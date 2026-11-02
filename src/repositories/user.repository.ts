import { PrismaClient, User } from '@prisma/client';
import { BaseRepository } from './base.repository';
import {
  UpsertUserDto,
  ListUsersFilter,
  CursorPagination,
  PaginatedResult,
} from './types';

export class UserRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Upserts an observed user for a tenant.
   * Priority:
   * 1. Match by (tenantId, platform, platformUserId) if platformUserId is present.
   * 2. Else match by (tenantId, platform, lower(uniqueId)) if uniqueId is present.
   * 3. Else insert as 'event_only' user.
   */
  async upsertUser(tenantId: string, data: UpsertUserDto): Promise<User> {
    const platform = data.platform ?? 'tiktok';
    const now = new Date();

    // 1. Preferred Stable Identity: platformUserId
    if (data.platformUserId) {
      let existing = await this.prisma.user.findFirst({
        where: {
          tenantId,
          platform,
          platformUserId: data.platformUserId,
        },
      });

      // If not found by platformUserId, check if there is an existing handle_fallback user with the same uniqueId
      if (!existing && data.uniqueId) {
        const normalizedUniqueId = data.uniqueId.replace(/^@/, '').toLowerCase().trim();
        existing = await this.prisma.user.findFirst({
          where: {
            tenantId,
            platform,
            uniqueId: { equals: normalizedUniqueId, mode: 'insensitive' },
            platformUserId: null,
          },
        });
      }

      if (existing) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: {
            platformUserId: data.platformUserId,
            uniqueId: data.uniqueId ?? existing.uniqueId,
            nickname: data.nickname ?? existing.nickname,
            avatarUrl: data.avatarUrl ?? existing.avatarUrl,
            verified: data.verified ?? existing.verified,
            identityQuality: 'platform_id',
            lastSeenAt: now,
            profileObservedAt: data.profileObservedAt ?? now,
          },
        });
      }

      try {
        return await this.prisma.user.create({
          data: {
            tenantId,
            platform,
            platformUserId: data.platformUserId,
            uniqueId: data.uniqueId ?? null,
            nickname: data.nickname ?? null,
            avatarUrl: data.avatarUrl ?? null,
            verified: data.verified ?? false,
            identityQuality: 'platform_id',
            firstSeenAt: now,
            lastSeenAt: now,
            profileObservedAt: data.profileObservedAt ?? now,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          const concurrent = await this.prisma.user.findFirst({
            where: {
              tenantId,
              platform,
              platformUserId: data.platformUserId,
            },
          });
          if (concurrent) {
            return this.prisma.user.update({
              where: { id: concurrent.id },
              data: {
                uniqueId: data.uniqueId ?? concurrent.uniqueId,
                nickname: data.nickname ?? concurrent.nickname,
                avatarUrl: data.avatarUrl ?? concurrent.avatarUrl,
                verified: data.verified ?? concurrent.verified,
                identityQuality: 'platform_id',
                lastSeenAt: now,
                profileObservedAt: data.profileObservedAt ?? now,
              },
            });
          }
        }
        throw err;
      }
    }

    // 2. Fallback Identity: uniqueId (handle)
    if (data.uniqueId) {
      const normalizedUniqueId = data.uniqueId.replace(/^@/, '').toLowerCase().trim();
      const existing = await this.prisma.user.findFirst({
        where: {
          tenantId,
          platform,
          uniqueId: { equals: normalizedUniqueId, mode: 'insensitive' },
        },
      });

      if (existing) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: {
            nickname: data.nickname ?? existing.nickname,
            avatarUrl: data.avatarUrl ?? existing.avatarUrl,
            verified: data.verified ?? existing.verified,
            identityQuality: existing.platformUserId ? existing.identityQuality : 'handle_fallback',
            lastSeenAt: now,
            profileObservedAt: data.profileObservedAt ?? now,
          },
        });
      }

      try {
        return await this.prisma.user.create({
          data: {
            tenantId,
            platform,
            platformUserId: null,
            uniqueId: normalizedUniqueId,
            nickname: data.nickname ?? null,
            avatarUrl: data.avatarUrl ?? null,
            verified: data.verified ?? false,
            identityQuality: 'handle_fallback',
            firstSeenAt: now,
            lastSeenAt: now,
            profileObservedAt: data.profileObservedAt ?? now,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          const concurrent = await this.prisma.user.findFirst({
            where: {
              tenantId,
              platform,
              uniqueId: { equals: normalizedUniqueId, mode: 'insensitive' },
            },
          });
          if (concurrent) {
            return this.prisma.user.update({
              where: { id: concurrent.id },
              data: {
                nickname: data.nickname ?? concurrent.nickname,
                avatarUrl: data.avatarUrl ?? concurrent.avatarUrl,
                verified: data.verified ?? concurrent.verified,
                identityQuality: concurrent.platformUserId ? concurrent.identityQuality : 'handle_fallback',
                lastSeenAt: now,
                profileObservedAt: data.profileObservedAt ?? now,
              },
            });
          }
        }
        throw err;
      }
    }

    // 3. Event-Only Record (no stable identity provided)
    return this.prisma.user.create({
      data: {
        tenantId,
        platform,
        platformUserId: null,
        uniqueId: null,
        nickname: data.nickname ?? null,
        avatarUrl: data.avatarUrl ?? null,
        verified: data.verified ?? false,
        identityQuality: 'event_only',
        firstSeenAt: now,
        lastSeenAt: now,
        profileObservedAt: data.profileObservedAt ?? now,
      },
    });
  }

  /**
   * Find observed user strictly scoped to tenant.
   */
  async findById(tenantId: string, id: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        id,
        tenantId,
      },
    });
  }

  /**
   * Delete an observed user strictly scoped to tenant.
   * Associated events retain their tenantId and session, but their userId is set to null via DB FK.
   */
  async deleteUser(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.findById(tenantId, id);
    if (!existing) {
      return false;
    }
    await this.prisma.user.delete({
      where: { id },
    });
    return true;
  }

  /**
   * List users observed by this tenant with search filter and cursor pagination.
   */
  async listByTenant(
    tenantId: string,
    filters?: ListUsersFilter,
    pagination?: CursorPagination
  ): Promise<PaginatedResult<User>> {
    const limit = this.normalizeLimit(pagination?.limit);
    const decoded = this.decodeCursor(pagination?.cursor);

    const where: any = {
      tenantId,
    };

    if (filters?.sessionId) {
      where.events = {
        some: {
          sessionId: filters.sessionId,
          tenantId,
        },
      };
    }

    const andConditions: any[] = [];

    if (filters?.search && filters.search.trim().length > 0) {
      const searchTerm = filters.search.trim();
      andConditions.push({
        OR: [
          { uniqueId: { contains: searchTerm, mode: 'insensitive' } },
          { nickname: { contains: searchTerm, mode: 'insensitive' } },
        ],
      });
    }

    if (decoded) {
      andConditions.push({
        OR: [
          { lastSeenAt: { lt: new Date(decoded.timestamp) } },
          {
            lastSeenAt: new Date(decoded.timestamp),
            id: { lt: decoded.id },
          },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const items = await this.prisma.user.findMany({
      where,
      take: limit + 1,
      orderBy: [
        { lastSeenAt: 'desc' },
        { id: 'desc' },
      ],
    });

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;

    let nextCursor: string | null = null;
    if (hasMore && resultItems.length > 0) {
      const last = resultItems[resultItems.length - 1];
      nextCursor = this.encodeCursor(last.id, last.lastSeenAt);
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
