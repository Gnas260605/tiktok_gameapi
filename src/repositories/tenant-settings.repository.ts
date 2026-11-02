import { PrismaClient, TenantSettings } from '@prisma/client';
import { UpsertTenantSettingsDto } from './types';

export class TenantSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get settings for a tenant.
   */
  async getSettings(tenantId: string): Promise<TenantSettings | null> {
    return this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });
  }

  /**
   * Upsert settings for a tenant.
   */
  async upsertSettings(
    tenantId: string,
    data: UpsertTenantSettingsDto
  ): Promise<TenantSettings> {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: {
        ...(data.eventRetentionDays !== undefined && { eventRetentionDays: data.eventRetentionDays }),
        ...(data.maxActiveSessions !== undefined && { maxActiveSessions: data.maxActiveSessions }),
        ...(data.settings !== undefined && { settings: data.settings }),
      },
      create: {
        tenantId,
        eventRetentionDays: data.eventRetentionDays ?? 30,
        maxActiveSessions: data.maxActiveSessions ?? 1,
        settings: data.settings ?? {},
      },
    });
  }
}
