/**
 * Cultivation Engine - Pure functions for Tu Tien Live cultivation rules.
 * NO Prisma / DB dependencies.
 *
 * References:
 * - docs/game/01_GDD.md §4.2, §5.2, §5.3, §7.2, §7.3, §7.4
 * - docs/game/05_Architecture.md §3
 */

export interface Progress {
  realmOrder: number;
  level: number;
  currentExp: bigint;
}

export interface LevelTable {
  required(realm: number, level: number): bigint;
}

/**
 * Default RealmBase values per GDD §4.2
 * Realm 1: Luyện Khí (1.000)
 * Realm 2: Trúc Cơ (2.500)
 * Realm 3: Kim Đan (6.250)
 * Realm 4: Nguyên Anh (15.600)
 * Realm 5: Hóa Thần (39.000)
 * Realm 6: Luyện Hư (97.600)
 * Realm 7: Hợp Thể (244.000)
 * Realm 8: Đại Thừa (610.000)
 */
export const DEFAULT_REALM_BASES: readonly bigint[] = [
  1000n,
  2500n,
  6250n,
  15600n,
  39000n,
  97600n,
  244000n,
  610000n,
] as const;

/**
 * Default LevelTable implementation based on GDD §4.2:
 * RequiredExp(realm r, level l) = RealmBase[r] * l
 */
export const defaultLevelTable: LevelTable = {
  required(realm: number, level: number): bigint {
    if (realm < 1 || realm > 8) {
      throw new Error(`Invalid realm: ${realm}. Must be between 1 and 8.`);
    }
    if (level < 1 || level > 10) {
      throw new Error(`Invalid level: ${level}. Must be between 1 and 10.`);
    }
    const base = DEFAULT_REALM_BASES[realm - 1];
    return base * BigInt(level);
  },
};

/**
 * Check if player has reached Đại Viên Mãn (Level 10 + currentExp >= required(r, 10)).
 */
export function isMaxLevel(p: Progress, t: LevelTable = defaultLevelTable): boolean {
  if (p.level < 10) return false;
  const req10 = t.required(p.realmOrder, 10);
  return p.currentExp >= req10;
}

/**
 * Calculate overflow (tu vi dư) at level 10.
 * Returns 0n if currentExp < required(r, 10) or level < 10.
 */
export function getOverflowExp(p: Progress, t: LevelTable = defaultLevelTable): bigint {
  if (p.level < 10) return 0n;
  const req10 = t.required(p.realmOrder, 10);
  return p.currentExp > req10 ? p.currentExp - req10 : 0n;
}

/**
 * Apply cultivation exp to progress.
 *
 * Rules (GDD §5.2, §5.3):
 * 1. A gift never crosses the realm boundary; it caps at level 10.
 * 2. Multi-level advancement advances level by level until level 10 or currentExp < required.
 * 3. At level 10, excess exp above (requiredExp(r, 10) + overflowCap) is capped and returned.
 *
 * @param p Current progress (immutable)
 * @param amount Amount of exp to add (must be >= 0)
 * @param t LevelTable lookup
 * @param overflowCap Maximum allowed overflow exp above required(r, 10) at level 10
 */
export function applyExp(
  p: Progress,
  amount: bigint,
  t: LevelTable = defaultLevelTable,
  overflowCap: bigint = 0n
): { next: Progress; levelsGained: number[]; capped: bigint } {
  if (amount < 0n) {
    throw new Error('Exp amount cannot be negative');
  }
  if (p.realmOrder < 1 || p.realmOrder > 8) {
    throw new Error(`Invalid realmOrder: ${p.realmOrder}. Must be between 1 and 8.`);
  }
  if (p.level < 1 || p.level > 10) {
    throw new Error(`Invalid level: ${p.level}. Must be between 1 and 10.`);
  }
  if (p.currentExp < 0n) {
    throw new Error('Current exp cannot be negative');
  }

  const effectiveOverflowCap = overflowCap < 0n ? 0n : overflowCap;

  let currExp = p.currentExp + amount;
  let currLevel = p.level;
  const levelsGained: number[] = [];
  let capped = 0n;

  while (currLevel < 10) {
    const req = t.required(p.realmOrder, currLevel);
    if (currExp < req) {
      break;
    }
    currExp -= req;
    currLevel += 1;
    levelsGained.push(currLevel);
  }

  if (currLevel === 10) {
    const req10 = t.required(p.realmOrder, 10);
    const maxAllowed = req10 + effectiveOverflowCap;
    if (currExp > maxAllowed) {
      capped = currExp - maxAllowed;
      currExp = maxAllowed;
    }
  }

  return {
    next: {
      realmOrder: p.realmOrder,
      level: currLevel,
      currentExp: currExp,
    },
    levelsGained,
    capped,
  };
}

/**
 * Calculate current breakthrough success chance in basis points (10000 = 100%).
 *
 * Formula (GDD §7.3):
 * GiftBonusBp = floor( Σ (diamondCount * repeatCount) * ChanceBpPer100Diamonds[realm] / 100 )
 * FinalChance = min(BaseChance[realm] + GiftBonus, MaxChance)
 *
 * @param baseBp Base chance in basis points (e.g. 9000 for 90%)
 * @param bonusDiamonds Total diamonds gifted during the breakthrough session
 * @param bpPer100 Basis points granted per 100 diamonds
 * @param maxBp Maximum chance cap in basis points (default 9500 = 95%)
 */
export function currentChanceBp(
  baseBp: number,
  bonusDiamonds: bigint,
  bpPer100: number,
  maxBp: number = 9500
): number {
  if (baseBp < 0) baseBp = 0;
  if (maxBp < 0) maxBp = 0;
  if (bpPer100 < 0) bpPer100 = 0;

  const validDiamonds = bonusDiamonds < 0n ? 0n : bonusDiamonds;
  const giftBonusBp = Number((validDiamonds * BigInt(bpPer100)) / 100n);
  const totalBp = baseBp + giftBonusBp;

  return Math.min(totalBp, maxBp);
}

/**
 * Resolve outcome of a breakthrough attempt.
 *
 * Rules (GDD §7.3, §7.4):
 * - Outcome: success if roll < finalBp, else failure.
 * - On success:
 *   - Realm increases by 1.
 *   - Starts at level 1 with previous overflow exp (tu vi dư = currentExp - required(r, 10)).
 *   - Overflow exp may immediately push player to higher levels in the new realm via applyExp(0).
 *   - Penalty is 0n.
 * - On failure:
 *   - Realm and level remain unchanged (level 10).
 *   - Penalty = floor(tu vi dư * penaltyRatio).
 *   - currentExp -= penalty (never drops below required(r, 10)).
 *
 * @param p Current progress (must be level 10 and reached Đại Viên Mãn)
 * @param finalBp Final breakthrough chance in basis points (0..10000)
 * @param roll Random integer roll in [0, 9999]
 * @param penaltyRatio Penalty ratio for failure (0..1, default 0.20 for 20%)
 * @param t LevelTable lookup
 */
export function resolveBreakthrough(
  p: Progress,
  finalBp: number,
  roll: number,
  penaltyRatio: number = 0.2,
  t: LevelTable = defaultLevelTable
): { result: 'success' | 'failure'; next: Progress; penalty: bigint } {
  if (p.realmOrder < 1 || p.realmOrder >= 8) {
    throw new Error(`Cannot breakthrough at realm ${p.realmOrder} (max realm is 8)`);
  }
  if (p.level !== 10) {
    throw new Error(`Cannot breakthrough at level ${p.level}. Must be level 10.`);
  }

  const req10 = t.required(p.realmOrder, 10);
  if (p.currentExp < req10) {
    throw new Error(
      `Cannot breakthrough: insufficient exp (${p.currentExp}/${req10}) for Đại Viên Mãn.`
    );
  }

  const tuViDu = p.currentExp - req10;
  const isSuccess = roll >= 0 && roll < finalBp;

  if (isSuccess) {
    const nextRealm = p.realmOrder + 1;
    // Advance in the new realm with carried-over overflow exp
    const initialNewProgress: Progress = {
      realmOrder: nextRealm,
      level: 1,
      currentExp: tuViDu,
    };
    // Let overflow exp advance levels in new realm
    const advancement = applyExp(initialNewProgress, 0n, t, 0n);

    return {
      result: 'success',
      next: advancement.next,
      penalty: 0n,
    };
  } else {
    const effectiveRatio = Math.max(0, Math.min(1, penaltyRatio));
    const penalty = BigInt(Math.floor(Number(tuViDu) * effectiveRatio));
    const nextExp = p.currentExp - penalty;

    return {
      result: 'failure',
      next: {
        realmOrder: p.realmOrder,
        level: 10,
        currentExp: nextExp < req10 ? req10 : nextExp,
      },
      penalty,
    };
  }
}
