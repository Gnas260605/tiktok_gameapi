import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  applyExp,
  currentChanceBp,
  resolveBreakthrough,
  isMaxLevel,
  getOverflowExp,
  defaultLevelTable,
  DEFAULT_REALM_BASES,
  Progress,
} from '../../../src/services/game/cultivation-engine';

describe('Cultivation Engine - Unit Tests', () => {
  describe('defaultLevelTable and constants', () => {
    it('verifies 8 default realm bases', () => {
      expect(DEFAULT_REALM_BASES).toHaveLength(8);
      expect(DEFAULT_REALM_BASES[0]).toBe(1000n); // Luyện Khí
      expect(DEFAULT_REALM_BASES[1]).toBe(2500n); // Trúc Cơ
      expect(DEFAULT_REALM_BASES[2]).toBe(6250n); // Kim Đan
      expect(DEFAULT_REALM_BASES[3]).toBe(15600n); // Nguyên Anh
      expect(DEFAULT_REALM_BASES[4]).toBe(39000n); // Hóa Thần
      expect(DEFAULT_REALM_BASES[5]).toBe(97600n); // Luyện Hư
      expect(DEFAULT_REALM_BASES[6]).toBe(244000n); // Hợp Thể
      expect(DEFAULT_REALM_BASES[7]).toBe(610000n); // Đại Thừa
    });

    it('calculates required exp for realms and levels', () => {
      // LK1 = 1000, LK3 = 3000, LK10 = 10000
      expect(defaultLevelTable.required(1, 1)).toBe(1000n);
      expect(defaultLevelTable.required(1, 3)).toBe(3000n);
      expect(defaultLevelTable.required(1, 10)).toBe(10000n);

      // TC1 = 2500, TC10 = 25000
      expect(defaultLevelTable.required(2, 1)).toBe(2500n);
      expect(defaultLevelTable.required(2, 10)).toBe(25000n);
    });

    it('throws error for invalid realm or level in LevelTable', () => {
      expect(() => defaultLevelTable.required(0, 1)).toThrow('Invalid realm: 0');
      expect(() => defaultLevelTable.required(9, 1)).toThrow('Invalid realm: 9');
      expect(() => defaultLevelTable.required(1, 0)).toThrow('Invalid level: 0');
      expect(() => defaultLevelTable.required(1, 11)).toThrow('Invalid level: 11');
    });
  });

  describe('Level Up (TC-L01 to TC-L07)', () => {
    // TC-L01: LK3 2.000/3.000 + 500 -> LK3 2.500/3.000
    it('TC-L01: adds exp without level up when threshold not reached', () => {
      const p: Progress = { realmOrder: 1, level: 3, currentExp: 2000n };
      const res = applyExp(p, 500n, defaultLevelTable, 30000n);

      expect(res.next.realmOrder).toBe(1);
      expect(res.next.level).toBe(3);
      expect(res.next.currentExp).toBe(2500n);
      expect(res.levelsGained).toEqual([]);
      expect(res.capped).toBe(0n);
    });

    // TC-L02: LK3 2.500/3.000 + 500 -> LK4 0/4.000
    it('TC-L02: advances exactly to next level with 0 remaining exp', () => {
      const p: Progress = { realmOrder: 1, level: 3, currentExp: 2500n };
      const res = applyExp(p, 500n, defaultLevelTable, 30000n);

      expect(res.next.realmOrder).toBe(1);
      expect(res.next.level).toBe(4);
      expect(res.next.currentExp).toBe(0n);
      expect(res.levelsGained).toEqual([4]);
      expect(res.capped).toBe(0n);
    });

    // TC-L03: LK3 2.500/3.000 + 1.000 -> LK4 500/4.000
    it('TC-L03: advances to next level carrying over remaining exp (spec example)', () => {
      const p: Progress = { realmOrder: 1, level: 3, currentExp: 2500n };
      const res = applyExp(p, 1000n, defaultLevelTable, 30000n);

      expect(res.next.realmOrder).toBe(1);
      expect(res.next.level).toBe(4);
      expect(res.next.currentExp).toBe(500n);
      expect(res.levelsGained).toEqual([4]);
      expect(res.capped).toBe(0n);
    });

    // TC-L04: LK1 0 + 10.000 (Galaxy) -> LK5 0/5.000; levelsGained=[2,3,4,5]
    it('TC-L04: multi-level jump with Galaxy 10.000 exp from LK1', () => {
      // 1000 (lvl 1) + 2000 (lvl 2) + 3000 (lvl 3) + 4000 (lvl 4) = 10000 -> LK5 0/5000
      const p: Progress = { realmOrder: 1, level: 1, currentExp: 0n };
      const res = applyExp(p, 10000n, defaultLevelTable, 30000n);

      expect(res.next.realmOrder).toBe(1);
      expect(res.next.level).toBe(5);
      expect(res.next.currentExp).toBe(0n);
      expect(res.levelsGained).toEqual([2, 3, 4, 5]);
      expect(res.capped).toBe(0n);
    });

    // TC-L05: LK9 + huge exp -> stops at LK10; cannot cross realm boundary; excess capped
    it('TC-L05: stops at Level 10, never crosses realm boundary, caps at overflowCap', () => {
      // LK9 has req(9) = 9000. LK10 has req(10) = 10000.
      // Overflow cap = 3 * 10000 = 30000.
      // Max allowed currentExp at level 10 = req10 + 30000 = 40000.
      const p: Progress = { realmOrder: 1, level: 9, currentExp: 0n };
      const hugeExp = 9000n + 10000n + 35000n; // 54000 exp total
      const res = applyExp(p, hugeExp, defaultLevelTable, 30000n);

      expect(res.next.realmOrder).toBe(1);
      expect(res.next.level).toBe(10);
      expect(res.next.currentExp).toBe(40000n); // 10000 + 30000
      expect(res.levelsGained).toEqual([10]);
      expect(res.capped).toBe(5000n); // 35000 - 30000
    });

    // TC-L06: Reaching exact level 10 threshold -> isMaxLevel=true
    it('TC-L06: detects Đại Viên Mãn (isMaxLevel)', () => {
      const notMax1: Progress = { realmOrder: 1, level: 9, currentExp: 8999n };
      expect(isMaxLevel(notMax1, defaultLevelTable)).toBe(false);

      const notMax2: Progress = { realmOrder: 1, level: 10, currentExp: 9999n };
      expect(isMaxLevel(notMax2, defaultLevelTable)).toBe(false);

      const exactlyMax: Progress = { realmOrder: 1, level: 10, currentExp: 10000n };
      expect(isMaxLevel(exactlyMax, defaultLevelTable)).toBe(true);

      const aboveMax: Progress = { realmOrder: 1, level: 10, currentExp: 15000n };
      expect(isMaxLevel(aboveMax, defaultLevelTable)).toBe(true);
      expect(getOverflowExp(aboveMax, defaultLevelTable)).toBe(5000n);
      expect(getOverflowExp(exactlyMax, defaultLevelTable)).toBe(0n);
      expect(getOverflowExp(notMax2, defaultLevelTable)).toBe(0n);
      expect(getOverflowExp(notMax1, defaultLevelTable)).toBe(0n);
    });

    // TC-L07: Đại Thừa (realm 8) level 10 receives exp
    it('TC-L07: Đại Thừa 10 receives exp and caps, cannot breakthrough', () => {
      const req10 = defaultLevelTable.required(8, 10); // 6.100.000
      const p: Progress = { realmOrder: 8, level: 10, currentExp: req10 };
      const overflowCap = 1000000n;
      const res = applyExp(p, 1500000n, defaultLevelTable, overflowCap);

      expect(res.next.realmOrder).toBe(8);
      expect(res.next.level).toBe(10);
      expect(res.next.currentExp).toBe(req10 + overflowCap);
      expect(res.capped).toBe(500000n);

      // Attempting breakthrough at realm 8 throws
      expect(() =>
        resolveBreakthrough(res.next, 9500, 0, 0.2, defaultLevelTable)
      ).toThrow('Cannot breakthrough at realm 8 (max realm is 8)');
    });
  });

  describe('Validation & Edge Cases in applyExp', () => {
    it('throws error for negative amount', () => {
      const p: Progress = { realmOrder: 1, level: 1, currentExp: 0n };
      expect(() => applyExp(p, -1n)).toThrow('Exp amount cannot be negative');
    });

    it('throws error for invalid realmOrder', () => {
      expect(() => applyExp({ realmOrder: 0, level: 1, currentExp: 0n }, 10n)).toThrow('Invalid realmOrder: 0');
      expect(() => applyExp({ realmOrder: 9, level: 1, currentExp: 0n }, 10n)).toThrow('Invalid realmOrder: 9');
    });

    it('throws error for invalid level', () => {
      expect(() => applyExp({ realmOrder: 1, level: 0, currentExp: 0n }, 10n)).toThrow('Invalid level: 0');
      expect(() => applyExp({ realmOrder: 1, level: 11, currentExp: 0n }, 10n)).toThrow('Invalid level: 11');
    });

    it('throws error for negative currentExp', () => {
      expect(() => applyExp({ realmOrder: 1, level: 1, currentExp: -10n }, 10n)).toThrow('Current exp cannot be negative');
    });

    it('handles negative overflowCap by clamping to 0n', () => {
      const p: Progress = { realmOrder: 1, level: 10, currentExp: 10000n };
      const res = applyExp(p, 500n, defaultLevelTable, -100n);
      expect(res.next.currentExp).toBe(10000n);
      expect(res.capped).toBe(500n);
    });

    it('does not mutate input progress object', () => {
      const p: Progress = { realmOrder: 1, level: 1, currentExp: 500n };
      const res = applyExp(p, 500n);
      expect(p.currentExp).toBe(500n);
      expect(p.level).toBe(1);
      expect(res.next.currentExp).toBe(0n);
      expect(res.next.level).toBe(2);
    });
  });

  describe('Property Testing (TC-L08)', () => {
    // TC-L08: Property test: 10.000 random gift streams
    // Invariant: current_exp >= 0, 1 <= level <= 10, total exp preserved:
    // Σ received = Σ required passed + current_exp + capped
    it('TC-L08: maintains conservation invariant across 10,000 random exp additions', () => {
      let state: Progress = { realmOrder: 1, level: 1, currentExp: 0n };
      let totalExpReceived = 0n;
      let totalPassedReq = 0n;
      let totalCapped = 0n;
      const overflowCap = 30000n;

      // Deterministic pseudo-random seed generator
      let seed = 123456789;
      const nextRand = (max: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % max;
      };

      for (let i = 0; i < 10000; i++) {
        // Random exp amount between 1 and 5000
        const giftExp = BigInt(nextRand(5000) + 1);
        totalExpReceived += giftExp;

        const beforeLevel = state.level;
        const res = applyExp(state, giftExp, defaultLevelTable, overflowCap);
        state = res.next;
        totalCapped += res.capped;

        // Sum req for each level gained
        for (let l = beforeLevel; l < state.level; l++) {
          totalPassedReq += defaultLevelTable.required(state.realmOrder, l);
        }

        // Invariants at every step
        expect(state.currentExp >= 0n).toBe(true);
        expect(state.level >= 1 && state.level <= 10).toBe(true);

        // Conservation equation:
        // totalExpReceived === totalPassedReq + state.currentExp + totalCapped
        expect(totalExpReceived).toBe(totalPassedReq + state.currentExp + totalCapped);
      }

      // Final checks
      expect(state.level).toBe(10);
      expect(isMaxLevel(state, defaultLevelTable)).toBe(true);
    });
  });

  describe('Breakthrough Chance Calculations (TC-B07, TC-B09)', () => {
    // TC-B07: Kim Đan, tặng 600💎 trong phiên -> gift_bonus_bp = 1002; chance 8002
    it('TC-B07: Kim Đan with 600 diamonds gives chance 8002', () => {
      const baseBp = 7000; // 70%
      const bpPer100 = 167; // 1.67% per 100💎
      const bonusDiamonds = 600n;
      const maxBp = 9500;

      const chance = currentChanceBp(baseBp, bonusDiamonds, bpPer100, maxBp);
      expect(chance).toBe(8002); // 7000 + 1002
    });

    // TC-B09: LK tặng Galaxy (1000💎) -> Chance = 9500 (trần)
    it('TC-B09: LK with Galaxy 1000 diamonds hits max chance cap 9500', () => {
      const baseBp = 9000; // 90%
      const bpPer100 = 1000; // 10% per 100💎
      const bonusDiamonds = 1000n;
      const maxBp = 9500;

      const chance = currentChanceBp(baseBp, bonusDiamonds, bpPer100, maxBp);
      expect(chance).toBe(9500);
    });

    it('handles negative or 0 bonus diamonds and clamps edge cases', () => {
      expect(currentChanceBp(9000, 0n, 1000, 9500)).toBe(9000);
      expect(currentChanceBp(9000, -100n, 1000, 9500)).toBe(9000);
      expect(currentChanceBp(-100, 100n, 100, 9500)).toBe(100);
      expect(currentChanceBp(9000, 100n, -50, 9500)).toBe(9000);
      expect(currentChanceBp(9000, 100n, 100, -10)).toBe(0);
    });
  });

  describe('Breakthrough Resolution (TC-B04, TC-B05, TC-B06)', () => {
    // TC-B04: roll = 0, chance 9000 -> succeeded; Trúc Cơ 1; tu vi dư chuyển & có thể lên tầng ngay
    it('TC-B04: success on roll < finalBp advances realm and carries over overflow exp', () => {
      // LK10 with 15000 exp (req10 = 10000, so 5000 overflow)
      const p: Progress = { realmOrder: 1, level: 10, currentExp: 15000n };
      // In Trúc Cơ (realm 2): req(1) = 2500, req(2) = 5000
      // 5000 overflow should pass TC level 1 (2500), leaving 2500 exp at TC level 2!
      const res = resolveBreakthrough(p, 9000, 0, 0.2, defaultLevelTable);

      expect(res.result).toBe('success');
      expect(res.next.realmOrder).toBe(2);
      expect(res.next.level).toBe(2);
      expect(res.next.currentExp).toBe(2500n);
      expect(res.penalty).toBe(0n);
    });

    // TC-B05: roll = 9999, chance 9000 -> failed; LK10; trừ 20% tu vi dư; cooldown 300s
    it('TC-B05: failure on roll >= finalBp keeps realm/level and deducts 20% tu vi dư', () => {
      const p: Progress = { realmOrder: 1, level: 10, currentExp: 15000n }; // tu vi dư = 5000
      const res = resolveBreakthrough(p, 9000, 9999, 0.2, defaultLevelTable);

      expect(res.result).toBe('failure');
      expect(res.next.realmOrder).toBe(1);
      expect(res.next.level).toBe(10);
      expect(res.penalty).toBe(1000n); // 20% of 5000 = 1000
      expect(res.next.currentExp).toBe(14000n); // 15000 - 1000
    });

    // TC-B06: Thất bại khi tu vi dư = 0 -> Phạt 0; không tụt dưới ngưỡng
    it('TC-B06: failure with 0 tu vi dư incurs 0 penalty and does not drop below threshold', () => {
      const p: Progress = { realmOrder: 1, level: 10, currentExp: 10000n }; // tu vi dư = 0
      const res = resolveBreakthrough(p, 9000, 9500, 0.2, defaultLevelTable);

      expect(res.result).toBe('failure');
      expect(res.next.realmOrder).toBe(1);
      expect(res.next.level).toBe(10);
      expect(res.penalty).toBe(0n);
      expect(res.next.currentExp).toBe(10000n);
    });

    it('rejects breakthrough if level < 10 or not reached Đại Viên Mãn', () => {
      expect(() =>
        resolveBreakthrough({ realmOrder: 1, level: 9, currentExp: 9000n }, 9000, 0)
      ).toThrow('Cannot breakthrough at level 9. Must be level 10.');

      expect(() =>
        resolveBreakthrough({ realmOrder: 1, level: 10, currentExp: 9999n }, 9000, 0)
      ).toThrow('insufficient exp (9999/10000)');
    });

    it('handles extreme penalty ratio edge cases correctly', () => {
      const p: Progress = { realmOrder: 1, level: 10, currentExp: 15000n };
      // penaltyRatio > 1 clamped to 1
      const res1 = resolveBreakthrough(p, 9000, 9500, 1.5, defaultLevelTable);
      expect(res1.penalty).toBe(5000n);
      expect(res1.next.currentExp).toBe(10000n);

      // penaltyRatio < 0 clamped to 0
      const res2 = resolveBreakthrough(p, 9000, 9500, -0.5, defaultLevelTable);
      expect(res2.penalty).toBe(0n);
      expect(res2.next.currentExp).toBe(15000n);
    });
  });

  describe('RNG Statistical Uniformity (TC-B20)', () => {
    // TC-B20: Thống kê RNG: 100.000 lần ở chance 5000 -> Tỷ lệ thành công 50% ± 0,5%
    it('TC-B20: verifies crypto.randomInt distribution within 50% ± 0.5% over 100,000 trials', () => {
      const trials = 100000;
      const targetBp = 5000;
      let successes = 0;

      for (let i = 0; i < trials; i++) {
        const roll = crypto.randomInt(0, 10000);
        if (roll < targetBp) {
          successes++;
        }
      }

      const successRate = successes / trials;
      // 50% ± 0.5% => [0.495, 0.505]
      expect(successRate).toBeGreaterThanOrEqual(0.495);
      expect(successRate).toBeLessThanOrEqual(0.505);
    });
  });
});
