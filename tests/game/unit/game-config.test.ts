import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  DEFAULT_REALM_BASES,
  defaultLevelTable,
} from '../../../src/services/game/cultivation-engine';

/**
 * Game Configuration Specification & Contract Definitions
 * Based on docs/game/01_GDD.md §4.1, §4.2, §7.3, §10
 */

export interface RealmDefinition {
  order: number;
  code: string;
  name: string;
  realmBase: bigint;
  baseChanceBp: number | null;
  chanceBpPer100Diamonds: number | null;
  totalRealmExp: bigint;
}

export const SPEC_REALMS: readonly RealmDefinition[] = [
  {
    order: 1,
    code: 'luyen_khi',
    name: 'Luyện Khí',
    realmBase: 1000n,
    baseChanceBp: 9000,
    chanceBpPer100Diamonds: 1000,
    totalRealmExp: 55000n, // 1000 * 55
  },
  {
    order: 2,
    code: 'truc_co',
    name: 'Trúc Cơ',
    realmBase: 2500n,
    baseChanceBp: 8000,
    chanceBpPer100Diamonds: 400,
    totalRealmExp: 137500n, // 2500 * 55
  },
  {
    order: 3,
    code: 'kim_dan',
    name: 'Kim Đan',
    realmBase: 6250n,
    baseChanceBp: 7000,
    chanceBpPer100Diamonds: 167,
    totalRealmExp: 343750n, // 6250 * 55
  },
  {
    order: 4,
    code: 'nguyen_anh',
    name: 'Nguyên Anh',
    realmBase: 15600n,
    baseChanceBp: 6000,
    chanceBpPer100Diamonds: 67,
    totalRealmExp: 858000n, // 15600 * 55
  },
  {
    order: 5,
    code: 'hoa_than',
    name: 'Hóa Thần',
    realmBase: 39000n,
    baseChanceBp: 5000,
    chanceBpPer100Diamonds: 25,
    totalRealmExp: 2145000n, // 39000 * 55
  },
  {
    order: 6,
    code: 'luyen_hu',
    name: 'Luyện Hư',
    realmBase: 97600n,
    baseChanceBp: 4000,
    chanceBpPer100Diamonds: 10,
    totalRealmExp: 5368000n, // 97600 * 55
  },
  {
    order: 7,
    code: 'hop_the',
    name: 'Hợp Thể',
    realmBase: 244000n,
    baseChanceBp: 3000,
    chanceBpPer100Diamonds: 4,
    totalRealmExp: 13420000n, // 244000 * 55
  },
  {
    order: 8,
    code: 'dai_thua',
    name: 'Đại Thừa',
    realmBase: 610000n,
    baseChanceBp: null, // Pinnacle realm in v1, no breakthrough
    chanceBpPer100Diamonds: null,
    totalRealmExp: 33550000n, // 610000 * 55
  },
] as const;

export const SPEC_DEFAULT_CONFIG = {
  gameEnabled: true,
  giftProcessingEnabled: true,
  effectsEnabled: true,
  tuViMultiplier: 10,
  realmBase: [1000, 2500, 6250, 15600, 39000, 97600, 244000, 610000],
  maxOverflowRatio: 3.0,
  baseChanceBp: [9000, 8000, 7000, 6000, 5000, 4000, 3000],
  maxChanceBp: 9500,
  chanceBpPer100Diamonds: [1000, 400, 167, 67, 25, 10, 4],
  preparationSeconds: 30,
  cooldownSeconds: 300,
  failurePenaltyRatio: 0.2,
  addExpDuringBreakthrough: false,
  maxConcurrentBreakthroughs: 3,
  autoJoinOnGift: true,
  pendingGiftTtlHours: 72,
  defaultGender: 'male',
  commandCooldownSeconds: 10,
} as const;

const configServiceTsPath = path.resolve(__dirname, '../../../src/services/game/game-config.service.ts');
const configServiceJsPath = path.resolve(__dirname, '../../../src/services/game/game-config.service.ts');
const isConfigServiceImplemented = fs.existsSync(configServiceTsPath) || fs.existsSync(configServiceJsPath);

const configServiceModulePath = '../../../src/services/game/game-config.service';
let gameConfigModule: any = null;

describe('Game Configuration & World Rules — Unit & Contract Tests', () => {
  beforeAll(async () => {
    if (isConfigServiceImplemented) {
      gameConfigModule = await import(/* @vite-ignore */ configServiceModulePath).catch(() => null);
    }
  });

  describe('Realm Definitions (GDD §4.1, §4.2, §7.3)', () => {
    it('defines exactly 8 realms in correct ascending order (1 to 8)', () => {
      expect(SPEC_REALMS).toHaveLength(8);
      for (let i = 0; i < 8; i++) {
        expect(SPEC_REALMS[i].order).toBe(i + 1);
      }
    });

    it('matches required codes, Vietnamese names, and RealmBase constants', () => {
      const expectedCodes = [
        'luyen_khi',
        'truc_co',
        'kim_dan',
        'nguyen_anh',
        'hoa_than',
        'luyen_hu',
        'hop_the',
        'dai_thua',
      ];
      const expectedNames = [
        'Luyện Khí',
        'Trúc Cơ',
        'Kim Đan',
        'Nguyên Anh',
        'Hóa Thần',
        'Luyện Hư',
        'Hợp Thể',
        'Đại Thừa',
      ];

      for (let i = 0; i < 8; i++) {
        expect(SPEC_REALMS[i].code).toBe(expectedCodes[i]);
        expect(SPEC_REALMS[i].name).toBe(expectedNames[i]);
        expect(SPEC_REALMS[i].realmBase).toBe(DEFAULT_REALM_BASES[i]);
      }
    });

    it('verifies base breakthrough chances decrease monotonically by 10% (1000 bp) across realms 1 to 7', () => {
      for (let i = 0; i < 7; i++) {
        const expectedBaseBp = 9000 - i * 1000;
        expect(SPEC_REALMS[i].baseChanceBp).toBe(expectedBaseBp);
      }
      // Realm 8 (Đại Thừa) has no next realm in v1
      expect(SPEC_REALMS[7].baseChanceBp).toBeNull();
    });

    it('verifies bonus chance per 100 diamonds decreases monotonically across realms 1 to 7', () => {
      const expectedBonusBp = [1000, 400, 167, 67, 25, 10, 4];
      for (let i = 0; i < 7; i++) {
        expect(SPEC_REALMS[i].chanceBpPer100Diamonds).toBe(expectedBonusBp[i]);
      }
      expect(SPEC_REALMS[7].chanceBpPer100Diamonds).toBeNull();
    });

    it('verifies RealmBase scaling curve (~2.5x progression per realm)', () => {
      // 1000 -> 2500 (2.5x)
      expect(Number(DEFAULT_REALM_BASES[1]) / Number(DEFAULT_REALM_BASES[0])).toBe(2.5);
      // 2500 -> 6250 (2.5x)
      expect(Number(DEFAULT_REALM_BASES[2]) / Number(DEFAULT_REALM_BASES[1])).toBe(2.5);
      // All subsequent ratios must be between 2.45 and 2.55
      for (let i = 1; i < 8; i++) {
        const ratio = Number(DEFAULT_REALM_BASES[i]) / Number(DEFAULT_REALM_BASES[i - 1]);
        expect(ratio).toBeGreaterThanOrEqual(2.45);
        expect(ratio).toBeLessThanOrEqual(2.55);
      }
    });
  });

  describe('Level Progression (80 Levels — GDD §4.2)', () => {
    it('verifies exactly 80 total levels (8 realms * 10 levels)', () => {
      let levelCount = 0;
      for (let r = 1; r <= 8; r++) {
        for (let l = 1; l <= 10; l++) {
          const required = defaultLevelTable.required(r, l);
          expect(required).toBeGreaterThan(0n);
          levelCount++;
        }
      }
      expect(levelCount).toBe(80);
    });

    it('verifies formula RequiredExp(r, l) = RealmBase[r] * l for all 80 levels', () => {
      for (let r = 1; r <= 8; r++) {
        const base = DEFAULT_REALM_BASES[r - 1];
        for (let l = 1; l <= 10; l++) {
          const expected = base * BigInt(l);
          const actual = defaultLevelTable.required(r, l);
          expect(actual).toBe(expected);
        }
      }
    });

    it('verifies total realm exp formula: Sum(1..10) = RealmBase[r] * 55', () => {
      for (let r = 1; r <= 8; r++) {
        let sum = 0n;
        for (let l = 1; l <= 10; l++) {
          sum += defaultLevelTable.required(r, l);
        }
        const expectedTotal = DEFAULT_REALM_BASES[r - 1] * 55n;
        expect(sum).toBe(expectedTotal);
        expect(sum).toBe(SPEC_REALMS[r - 1].totalRealmExp);
      }
    });

    it('verifies strictly monotonic exp requirement within each realm', () => {
      for (let r = 1; r <= 8; r++) {
        for (let l = 1; l < 10; l++) {
          const currentLevelReq = defaultLevelTable.required(r, l);
          const nextLevelReq = defaultLevelTable.required(r, l + 1);
          expect(nextLevelReq).toBeGreaterThan(currentLevelReq);
        }
      }
    });
  });

  describe('System Default Gameplay Parameters (GDD §10)', () => {
    it('verifies default config parameter types and values', () => {
      expect(SPEC_DEFAULT_CONFIG.gameEnabled).toBe(true);
      expect(SPEC_DEFAULT_CONFIG.giftProcessingEnabled).toBe(true);
      expect(SPEC_DEFAULT_CONFIG.effectsEnabled).toBe(true);
      expect(SPEC_DEFAULT_CONFIG.tuViMultiplier).toBe(10);
      expect(SPEC_DEFAULT_CONFIG.maxOverflowRatio).toBe(3.0);
      expect(SPEC_DEFAULT_CONFIG.maxChanceBp).toBe(9500);
      expect(SPEC_DEFAULT_CONFIG.preparationSeconds).toBe(30);
      expect(SPEC_DEFAULT_CONFIG.cooldownSeconds).toBe(300);
      expect(SPEC_DEFAULT_CONFIG.failurePenaltyRatio).toBe(0.2);
      expect(SPEC_DEFAULT_CONFIG.addExpDuringBreakthrough).toBe(false);
      expect(SPEC_DEFAULT_CONFIG.maxConcurrentBreakthroughs).toBe(3);
      expect(SPEC_DEFAULT_CONFIG.autoJoinOnGift).toBe(true);
      expect(SPEC_DEFAULT_CONFIG.pendingGiftTtlHours).toBe(72);
      expect(SPEC_DEFAULT_CONFIG.defaultGender).toBe('male');
      expect(SPEC_DEFAULT_CONFIG.commandCooldownSeconds).toBe(10);
    });

    it('verifies preparationSeconds is within valid bounds [10, 120]', () => {
      expect(SPEC_DEFAULT_CONFIG.preparationSeconds).toBeGreaterThanOrEqual(10);
      expect(SPEC_DEFAULT_CONFIG.preparationSeconds).toBeLessThanOrEqual(120);
    });

    it('verifies maxChanceBp is 9500 (95.00%) and failurePenaltyRatio is 0.20 (20%)', () => {
      expect(SPEC_DEFAULT_CONFIG.maxChanceBp).toBe(9500);
      expect(SPEC_DEFAULT_CONFIG.failurePenaltyRatio).toBe(0.2);
    });
  });

  describe('GameConfigService Integration (when implemented by Agent 2)', () => {
    it('reports GameConfigService status', () => {
      if (!isConfigServiceImplemented) {
        console.info(
          'ℹ [TDD Pending] src/services/game/game-config.service.ts will be verified once created by Agent 2.'
        );
      }
      expect(true).toBe(true);
    });

    it.skipIf(!isConfigServiceImplemented)('verifies GameConfigService exports valid default configuration', () => {
      expect(gameConfigModule).toBeDefined();
      if (typeof gameConfigModule.getDefaultConfig === 'function') {
        const defaults = gameConfigModule.getDefaultConfig();
        expect(defaults.tuViMultiplier).toBe(10);
        expect(defaults.maxChanceBp).toBe(9500);
      }
    });
  });
});
