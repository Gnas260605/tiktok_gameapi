import crypto from 'crypto';
import { ApiKey, Tenant } from '@prisma/client';
import { ApiKeyRepository } from '../../repositories/api-key.repository';

export interface ValidatedAuthContext {
  tenant: Tenant;
  apiKey: ApiKey;
}

export class AuthService {
  constructor(private readonly apiKeyRepo: ApiKeyRepository) {}

  /**
   * Hashes a plaintext API key with SHA-256 for secure database lookup.
   */
  public static hashKey(plaintextKey: string): string {
    return crypto.createHash('sha256').update(plaintextKey.trim()).digest('hex');
  }

  /**
   * Generates a new cryptographically secure API key with a prefix.
   */
  public static generatePlaintextKey(prefix = 'tik_live'): string {
    const randomBytes = crypto.randomBytes(24).toString('hex');
    return `${prefix}_${randomBytes}`;
  }

  /**
   * Authenticates an API key and ensures the owning tenant is active.
   */
  public async authenticate(plaintextKey: string): Promise<ValidatedAuthContext> {
    if (!plaintextKey || typeof plaintextKey !== 'string') {
      const err = new Error('API key is required');
      (err as any).statusCode = 401;
      (err as any).code = 'UNAUTHORIZED';
      throw err;
    }

    const keyHash = AuthService.hashKey(plaintextKey);
    const result = await this.apiKeyRepo.validateKey(keyHash);

    if (!result.valid) {
      if (result.reason === 'NOT_FOUND') {
        const err = new Error('Invalid API key provided');
        (err as any).statusCode = 401;
        (err as any).code = 'UNAUTHORIZED';
        throw err;
      }

      if (result.reason === 'REVOKED') {
        const err = new Error('API key has been revoked');
        (err as any).statusCode = 403;
        (err as any).code = 'FORBIDDEN';
        throw err;
      }

      if (result.reason === 'EXPIRED') {
        const err = new Error('API key has expired');
        (err as any).statusCode = 403;
        (err as any).code = 'FORBIDDEN';
        throw err;
      }

      if (result.reason === 'TENANT_INACTIVE') {
        const err = new Error('Tenant account is not active');
        (err as any).statusCode = 403;
        (err as any).code = 'FORBIDDEN';
        throw err;
      }
    }

    if (!result.apiKey || !result.tenant) {
      const err = new Error('Authentication context resolution failed');
      (err as any).statusCode = 401;
      (err as any).code = 'UNAUTHORIZED';
      throw err;
    }

    // Fire-and-forget update of lastUsedAt
    this.apiKeyRepo.updateLastUsed(result.tenant.id, result.apiKey.id).catch(() => {});

    return {
      tenant: result.tenant,
      apiKey: result.apiKey,
    };
  }

  /**
   * Creates a new API key for tenant.
   * Returns plaintext secret only once.
   */
  public async createApiKey(
    tenantId: string,
    name: string,
    expiresAt?: Date | null
  ): Promise<{
    id: string;
    name: string;
    key: string;
    keyPrefix: string;
    createdAt: Date;
    expiresAt: Date | null;
  }> {
    const keyPrefix = 'tik_live';
    const plaintextKey = AuthService.generatePlaintextKey(keyPrefix);
    const keyHash = AuthService.hashKey(plaintextKey);

    const apiKey = await this.apiKeyRepo.createKey(tenantId, {
      name,
      keyPrefix,
      keyHash,
      expiresAt: expiresAt ?? undefined,
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      key: plaintextKey,
      keyPrefix: apiKey.keyPrefix,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
    };
  }

  public async listApiKeys(tenantId: string): Promise<ApiKey[]> {
    return this.apiKeyRepo.listByTenant(tenantId);
  }

  public async revokeApiKey(tenantId: string, keyId: string): Promise<ApiKey | null> {
    return this.apiKeyRepo.revokeKey(tenantId, keyId);
  }
}
