import { PrismaClient, ApiKey, Tenant } from '@prisma/client';
import { BaseRepository } from './base.repository';
import { CreateApiKeyDto, ApiKeyValidationResult } from './types';

export class ApiKeyRepository extends BaseRepository {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Look up API key by SHA-256 hash. Used by authentication middleware.
   * Resolves the key and eager-loads the tenant context.
   */
  async findByHash(keyHash: string): Promise<(ApiKey & { tenant: Tenant }) | null> {
    return this.prisma.apiKey.findFirst({
      where: { keyHash },
      include: { tenant: true },
    });
  }

  /**
   * Validates key existence, status, expiration, and tenant status in one atomic check.
   */
  async validateKey(keyHash: string): Promise<ApiKeyValidationResult> {
    const apiKey = await this.findByHash(keyHash);
    if (!apiKey) {
      return { valid: false, reason: 'NOT_FOUND' };
    }

    if (apiKey.status === 'revoked' || apiKey.revoked) {
      return { valid: false, reason: 'REVOKED', apiKey, tenant: apiKey.tenant };
    }

    if (apiKey.status === 'expired' || (apiKey.expiresAt && apiKey.expiresAt <= new Date())) {
      return { valid: false, reason: 'EXPIRED', apiKey, tenant: apiKey.tenant };
    }

    if (apiKey.tenant.status !== 'active') {
      return { valid: false, reason: 'TENANT_INACTIVE', apiKey, tenant: apiKey.tenant };
    }

    return { valid: true, apiKey, tenant: apiKey.tenant };
  }

  /**
   * Updates lastUsedAt timestamp. Strictly scoped by tenantId.
   */
  async updateLastUsed(tenantId: string, keyId: string, timestamp = new Date()): Promise<void> {
    await this.prisma.apiKey.updateMany({
      where: {
        id: keyId,
        tenantId,
      },
      data: {
        lastUsedAt: timestamp,
      },
    });
  }

  /**
   * Create an API key for a tenant.
   */
  async createKey(tenantId: string, data: CreateApiKeyDto): Promise<ApiKey> {
    return this.prisma.apiKey.create({
      data: {
        tenantId,
        name: data.name,
        keyPrefix: data.keyPrefix,
        keyHash: data.keyHash,
        status: 'active',
        revoked: false,
        expiresAt: data.expiresAt ?? null,
      },
    });
  }

  /**
   * List all API keys belonging to a tenant (never returns hash in service layer).
   */
  async listByTenant(tenantId: string): Promise<ApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get specific API key metadata. Scoped by tenantId.
   */
  async findById(tenantId: string, keyId: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findFirst({
      where: {
        id: keyId,
        tenantId,
      },
    });
  }

  /**
   * Revoke an API key. Strictly scoped to tenantId.
   */
  async revokeKey(tenantId: string, keyId: string): Promise<ApiKey | null> {
    const existing = await this.findById(tenantId, keyId);
    if (!existing) return null;

    return this.prisma.apiKey.update({
      where: { id: keyId },
      data: {
        status: 'revoked',
        revoked: true,
        revokedAt: new Date(),
      },
    });
  }
}
