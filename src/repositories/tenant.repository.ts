import { PrismaClient, Tenant } from '@prisma/client';
import { TenantStatus } from './types';

export class TenantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find tenant by ID.
   * @param tenantId Target tenant ID
   */
  async findById(tenantId: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
  }

  /**
   * Checks if tenant exists and has active status.
   * @param tenantId Target tenant ID
   */
  async isActive(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    return tenant?.status === 'active';
  }

  /**
   * Provision a new tenant.
   */
  async create(data: { id?: string; name: string; status?: TenantStatus }): Promise<Tenant> {
    return this.prisma.tenant.create({
      data: {
        ...(data.id && { id: data.id }),
        name: data.name,
        status: data.status ?? 'active',
      },
    });
  }

  /**
   * Update tenant status (active, suspended, deleted).
   */
  async updateStatus(tenantId: string, status: TenantStatus): Promise<Tenant | null> {
    try {
      return await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { status },
      });
    } catch (e: any) {
      if (e.code === 'P2025') return null; // Record not found
      throw e;
    }
  }

  /**
   * List tenants (restricted to admin or testing).
   */
  async listAll(limit = 50): Promise<Tenant[]> {
    return this.prisma.tenant.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }
}
