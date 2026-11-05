import { GameConfigRepository } from '../../repositories/game/game-config.repository';
import { GameConfig, GameConfigValues, CultivationRealm } from './types';
import { LevelTable, defaultLevelTable } from './cultivation-engine';
import { DEFAULT_GAME_CONFIG_VALUES } from '../../../prisma/seed-tutien';

interface CachedTenantConfig {
  config: GameConfig;
  levelTable: LevelTable;
  realms: CultivationRealm[];
  cachedAt: number;
}

export class GameConfigError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'BAD_REQUEST',
    public readonly details?: any
  ) {
    super(message);
    this.name = 'GameConfigError';
  }
}

export class GameConfigService {
  private readonly cache = new Map<string, CachedTenantConfig>();
  private readonly cacheTtlMs = 60000; // 60s TTL as safety fallback

  constructor(private readonly configRepo: GameConfigRepository) {}

  /**
   * Invalidate tenant cache.
   */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /**
   * Clear all caches (useful in testing).
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cached entry if valid.
   */
  private getValidCache(tenantId: string): CachedTenantConfig | null {
    const entry = this.cache.get(tenantId);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.cacheTtlMs) {
      this.cache.delete(tenantId);
      return null;
    }
    return entry;
  }

  /**
   * Load and cache full tenant game configuration.
   */
  async getConfig(tenantId: string): Promise<GameConfig> {
    const cached = this.getValidCache(tenantId);
    if (cached) return cached.config;

    await this.configRepo.ensureTenantSeeded(tenantId);
    const rows = await this.configRepo.getConfigs(tenantId);

    const values: GameConfigValues = { ...(DEFAULT_GAME_CONFIG_VALUES as GameConfigValues) };
    let maxRevision = 1;
    let latestUpdatedAt = new Date(0);

    for (const row of rows) {
      if (row.configKey in values) {
        (values as any)[row.configKey] = row.configValue;
      }
      if (row.revision > maxRevision) {
        maxRevision = row.revision;
      }
      if (row.updatedAt > latestUpdatedAt) {
        latestUpdatedAt = row.updatedAt;
      }
    }

    const config: GameConfig = {
      revision: maxRevision,
      values,
      updatedAt: latestUpdatedAt.getTime() > 0 ? latestUpdatedAt : new Date(),
    };

    // Populate level table and realms alongside
    const levelTable = await this.loadLevelTable(tenantId);
    const realms = await this.configRepo.getRealms(tenantId);

    this.cache.set(tenantId, {
      config,
      levelTable,
      realms,
      cachedAt: Date.now(),
    });

    return config;
  }

  /**
   * Get LevelTable for tenant (cached).
   */
  async getLevelTable(tenantId: string): Promise<LevelTable> {
    const cached = this.getValidCache(tenantId);
    if (cached) return cached.levelTable;

    // Trigger full load
    await this.getConfig(tenantId);
    return this.cache.get(tenantId)?.levelTable ?? defaultLevelTable;
  }

  /**
   * Get Realms for tenant (cached).
   */
  async getRealms(tenantId: string): Promise<CultivationRealm[]> {
    const cached = this.getValidCache(tenantId);
    if (cached) return cached.realms;

    // Trigger full load
    await this.getConfig(tenantId);
    return this.cache.get(tenantId)?.realms ?? [];
  }

  /**
   * Internal loader for LevelTable.
   */
  private async loadLevelTable(tenantId: string): Promise<LevelTable> {
    const levelRows = await this.configRepo.getLevels(tenantId);
    if (levelRows.length === 0) {
      return defaultLevelTable;
    }

    const map = new Map<string, bigint>();
    for (const row of levelRows) {
      map.set(`${row.realmOrder}:${row.level}`, row.requiredExp);
    }

    return {
      required(realm: number, level: number): bigint {
        const val = map.get(`${realm}:${level}`);
        if (val !== undefined) return val;
        return defaultLevelTable.required(realm, level);
      },
    };
  }

  /**
   * Validate configuration updates according to GDD §10 and OpenAPI schemas.
   */
  private validateConfigValues(updates: Partial<GameConfigValues>): void {
    if (updates.tuViMultiplier !== undefined) {
      if (!Number.isInteger(updates.tuViMultiplier) || updates.tuViMultiplier < 1 || updates.tuViMultiplier > 1000) {
        throw new GameConfigError('tuViMultiplier must be an integer between 1 and 1000', 400, 'INVALID_CONFIG_VALUE', { field: 'tuViMultiplier' });
      }
    }
    if (updates.maxOverflowRatio !== undefined) {
      if (typeof updates.maxOverflowRatio !== 'number' || updates.maxOverflowRatio < 0 || updates.maxOverflowRatio > 100) {
        throw new GameConfigError('maxOverflowRatio must be a number between 0 and 100', 400, 'INVALID_CONFIG_VALUE', { field: 'maxOverflowRatio' });
      }
    }
    if (updates.maxChanceBp !== undefined) {
      if (!Number.isInteger(updates.maxChanceBp) || updates.maxChanceBp < 0 || updates.maxChanceBp > 10000) {
        throw new GameConfigError('maxChanceBp must be an integer between 0 and 10000', 400, 'INVALID_CONFIG_VALUE', { field: 'maxChanceBp' });
      }
    }
    if (updates.preparationSeconds !== undefined) {
      if (!Number.isInteger(updates.preparationSeconds) || updates.preparationSeconds < 10 || updates.preparationSeconds > 120) {
        throw new GameConfigError('preparationSeconds must be an integer between 10 and 120', 400, 'INVALID_CONFIG_VALUE', { field: 'preparationSeconds' });
      }
    }
    if (updates.cooldownSeconds !== undefined) {
      if (!Number.isInteger(updates.cooldownSeconds) || updates.cooldownSeconds < 0 || updates.cooldownSeconds > 86400) {
        throw new GameConfigError('cooldownSeconds must be an integer between 0 and 86400', 400, 'INVALID_CONFIG_VALUE', { field: 'cooldownSeconds' });
      }
    }
    if (updates.failurePenaltyRatio !== undefined) {
      if (typeof updates.failurePenaltyRatio !== 'number' || updates.failurePenaltyRatio < 0 || updates.failurePenaltyRatio > 1) {
        throw new GameConfigError('failurePenaltyRatio must be a number between 0 and 1', 400, 'INVALID_CONFIG_VALUE', { field: 'failurePenaltyRatio' });
      }
    }
    if (updates.maxConcurrentBreakthroughs !== undefined) {
      if (!Number.isInteger(updates.maxConcurrentBreakthroughs) || updates.maxConcurrentBreakthroughs < 1 || updates.maxConcurrentBreakthroughs > 10) {
        throw new GameConfigError('maxConcurrentBreakthroughs must be an integer between 1 and 10', 400, 'INVALID_CONFIG_VALUE', { field: 'maxConcurrentBreakthroughs' });
      }
    }
    if (updates.pendingGiftTtlHours !== undefined) {
      if (!Number.isInteger(updates.pendingGiftTtlHours) || updates.pendingGiftTtlHours < 1 || updates.pendingGiftTtlHours > 720) {
        throw new GameConfigError('pendingGiftTtlHours must be an integer between 1 and 720', 400, 'INVALID_CONFIG_VALUE', { field: 'pendingGiftTtlHours' });
      }
    }
    if (updates.commandCooldownSeconds !== undefined) {
      if (!Number.isInteger(updates.commandCooldownSeconds) || updates.commandCooldownSeconds < 0 || updates.commandCooldownSeconds > 300) {
        throw new GameConfigError('commandCooldownSeconds must be an integer between 0 and 300', 400, 'INVALID_CONFIG_VALUE', { field: 'commandCooldownSeconds' });
      }
    }
    if (updates.defaultGender !== undefined) {
      if (updates.defaultGender !== 'male' && updates.defaultGender !== 'female') {
        throw new GameConfigError('defaultGender must be either male or female', 400, 'INVALID_CONFIG_VALUE', { field: 'defaultGender' });
      }
    }
  }

  /**
   * Update configurations with optimistic locking (baseRevision).
   */
  async updateConfig(
    tenantId: string,
    baseRevision: number,
    updates: Partial<GameConfigValues>,
    reason: string,
    actorApiKeyId?: string,
    requestId?: string
  ): Promise<GameConfig> {
    if (!reason || reason.trim().length === 0) {
      throw new GameConfigError('Reason is required for updating configuration', 400, 'REASON_REQUIRED');
    }

    // Bust cache to get fresh current revision from DB
    this.invalidate(tenantId);
    const current = await this.getConfig(tenantId);

    if (current.revision !== baseRevision) {
      throw new GameConfigError(
        `Config revision conflict: current revision is ${current.revision}, provided baseRevision was ${baseRevision}`,
        409,
        'REVISION_CONFLICT',
        { currentRevision: current.revision, baseRevision }
      );
    }

    this.validateConfigValues(updates);

    const newRevision = baseRevision + 1;
    const beforeValues = { ...current.values };
    const afterValues = { ...current.values, ...updates };

    await this.configRepo.updateConfigs(tenantId, updates, newRevision, {
      actorApiKeyId,
      before: beforeValues,
      after: afterValues,
      reason: reason.trim(),
      requestId,
    });

    // Invalidate cache again
    this.invalidate(tenantId);

    return this.getConfig(tenantId);
  }
}
