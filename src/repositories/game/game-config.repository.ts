import {
  PrismaClient,
  GameConfiguration,
  CultivationRealm,
  CultivationLevel,
} from '@prisma/client';
import { BaseRepository } from '../base.repository';
import { seedTenantTuTien } from '../../../prisma/seed-tutien';

export class GameConfigRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Fetch all game configuration rows for a tenant.
   */
  async getConfigs(tenantId: string): Promise<GameConfiguration[]> {
    return this.prisma.gameConfiguration.findMany({
      where: { tenantId },
    });
  }

  /**
   * Fetch all 8 cultivation realms for a tenant, ordered by realm_order ascending.
   */
  async getRealms(tenantId: string): Promise<CultivationRealm[]> {
    return this.prisma.cultivationRealm.findMany({
      where: { tenantId },
      orderBy: { realmOrder: 'asc' },
    });
  }

  /**
   * Fetch all 80 cultivation levels for a tenant, ordered by realm_order and level.
   */
  async getLevels(tenantId: string): Promise<CultivationLevel[]> {
    return this.prisma.cultivationLevel.findMany({
      where: { tenantId },
      orderBy: [{ realmOrder: 'asc' }, { level: 'asc' }],
    });
  }

  /**
   * Ensure a tenant has Tu Tien realms, levels, and default configs seeded.
   */
  async ensureTenantSeeded(tenantId: string): Promise<void> {
    const realmCount = await this.prisma.cultivationRealm.count({
      where: { tenantId },
    });
    if (realmCount < 8) {
      await seedTenantTuTien(this.prisma, tenantId);
    }
  }

  /**
   * Upsert a set of configurations in a transaction, setting the revision and recording admin audit log.
   */
  async updateConfigs(
    tenantId: string,
    updates: Record<string, any>,
    newRevision: number,
    audit?: {
      actorApiKeyId?: string;
      before: Record<string, any>;
      after: Record<string, any>;
      reason: string;
      requestId?: string;
    }
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(updates)) {
        await tx.gameConfiguration.upsert({
          where: {
            tenantId_configKey: {
              tenantId,
              configKey: key,
            },
          },
          update: {
            configValue: value,
            revision: newRevision,
            updatedByApiKeyId: audit?.actorApiKeyId,
          },
          create: {
            tenantId,
            configKey: key,
            configValue: value,
            revision: newRevision,
            updatedByApiKeyId: audit?.actorApiKeyId,
          },
        });
      }

      if (audit) {
        await tx.adminAuditLog.create({
          data: {
            tenantId,
            actorApiKeyId: audit.actorApiKeyId,
            action: 'config_update',
            targetType: 'game_configuration',
            targetId: tenantId,
            before: audit.before,
            after: audit.after,
            reason: audit.reason,
            requestId: audit.requestId,
          },
        });
      }
    });
  }
}
