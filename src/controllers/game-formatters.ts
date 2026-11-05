import { CultivationRealm, CultivationLevel, GamePlayer } from '@prisma/client';
import { PlayerProfile } from '../services/game/player.service';
import { isMaxLevel } from '../services/game/cultivation-engine';

/**
 * Format a PlayerProfile into the OpenAPI Player schema.
 * All BigInt values are converted to string. Dates to ISO strings.
 */
export function formatPlayerProfile(p: PlayerProfile | null | undefined): any {
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId,
    username: p.username,
    nickname: p.nickname,
    avatarUrl: p.avatarUrl,
    gender: p.gender,
    realmOrder: p.realmOrder,
    realmName: p.realmName,
    level: p.level,
    isMaxLevel: p.isMaxLevel,
    currentExp: p.currentExp.toString(),
    requiredExp: p.requiredExp.toString(),
    totalCultivation: p.totalCultivation.toString(),
    totalDiamondsGifted: p.totalDiamondsGifted.toString(),
    breakthroughSuccessCount: p.breakthroughSuccessCount,
    breakthroughFailCount: p.breakthroughFailCount,
    breakthroughCooldownUntil: p.breakthroughCooldownUntil
      ? p.breakthroughCooldownUntil.toISOString()
      : null,
    characterAsset: p.characterAsset,
    status: p.status,
    version: p.version,
    joinedAt: p.joinedAt.toISOString(),
    lastActiveAt: p.lastActiveAt.toISOString(),
  };
}

/**
 * Format a raw GamePlayer into OpenAPI Player schema using realm & level lookups.
 */
export function formatPlayer(
  p: GamePlayer,
  realms: CultivationRealm[],
  levelTable: { required: (realm: number, level: number) => bigint }
): any {
  const realm = realms.find((r) => r.realmOrder === p.realmOrder);
  const realmName = realm?.name ?? `Cảnh giới ${p.realmOrder}`;
  const characterAsset =
    p.gender === 'female'
      ? realm?.characterFemaleAsset ?? 'female_default.webp'
      : realm?.characterMaleAsset ?? 'male_default.webp';

  const requiredExp = levelTable.required(p.realmOrder, p.level);
  const maxLvl = isMaxLevel(
    { realmOrder: p.realmOrder, level: p.level, currentExp: p.currentExp },
    levelTable
  );

  return {
    id: p.id,
    userId: p.userId,
    username: p.username,
    nickname: p.nickname,
    avatarUrl: p.avatarUrl,
    gender: p.gender,
    realmOrder: p.realmOrder,
    realmName,
    level: p.level,
    isMaxLevel: maxLvl,
    currentExp: p.currentExp.toString(),
    requiredExp: requiredExp.toString(),
    totalCultivation: p.totalCultivation.toString(),
    totalDiamondsGifted: p.totalDiamondsGifted.toString(),
    breakthroughSuccessCount: p.breakthroughSuccessCount,
    breakthroughFailCount: p.breakthroughFailCount,
    breakthroughCooldownUntil: p.breakthroughCooldownUntil
      ? p.breakthroughCooldownUntil.toISOString()
      : null,
    characterAsset,
    status: p.status,
    version: p.version,
    joinedAt: p.joinedAt.toISOString(),
    lastActiveAt: p.lastActiveAt.toISOString(),
  };
}

/**
 * Format a BreakthroughSession (with optional history) into OpenAPI Breakthrough schema.
 */
export function formatBreakthrough(session: any): any {
  if (!session) return null;

  const currentChanceBp = Math.min(
    session.baseChanceBp + (session.giftBonusBp || 0),
    session.maxChanceBp ?? 9500
  );

  return {
    id: session.id,
    playerId: session.playerId,
    liveSessionId: session.liveSessionId,
    sourceRealmOrder: session.sourceRealmOrder,
    targetRealmOrder: session.targetRealmOrder,
    status: session.status,
    baseChanceBp: session.baseChanceBp,
    giftBonusBp: session.giftBonusBp ?? 0,
    currentChanceBp,
    maxChanceBp: session.maxChanceBp ?? 9500,
    finalChanceBp: session.finalChanceBp ?? null,
    bonusDiamonds: (session.bonusDiamonds ?? 0n).toString(),
    roll: session.history?.roll ?? null,
    cultivationPenalty:
      session.history?.cultivationPenalty !== undefined && session.history?.cultivationPenalty !== null
        ? session.history.cultivationPenalty.toString()
        : null,
    startedAt:
      session.startedAt instanceof Date ? session.startedAt.toISOString() : session.startedAt,
    endsAt: session.endsAt instanceof Date ? session.endsAt.toISOString() : session.endsAt,
    endedAt: session.endedAt
      ? session.endedAt instanceof Date
        ? session.endedAt.toISOString()
        : session.endedAt
      : null,
  };
}

/**
 * Format a GiftTransaction into OpenAPI GiftTransaction schema.
 */
export function formatGiftTransaction(tx: any): any {
  if (!tx) return null;

  const before =
    tx.realmBefore !== null && tx.realmBefore !== undefined
      ? {
          realmOrder: tx.realmBefore,
          level: tx.levelBefore,
          currentExp: tx.expBefore !== null && tx.expBefore !== undefined ? tx.expBefore.toString() : '0',
        }
      : null;

  const after =
    tx.realmAfter !== null && tx.realmAfter !== undefined
      ? {
          realmOrder: tx.realmAfter,
          level: tx.levelAfter,
          currentExp: tx.expAfter !== null && tx.expAfter !== undefined ? tx.expAfter.toString() : '0',
        }
      : null;

  return {
    id: tx.id,
    eventId: tx.eventId ?? null,
    liveSessionId: tx.liveSessionId,
    playerId: tx.playerId ?? null,
    breakthroughId: tx.breakthroughSessionId ?? null,
    giftId: tx.giftId,
    giftName: tx.giftName,
    diamondValue: tx.diamondValue ?? null,
    giftQuantity: tx.giftQuantity ?? 1,
    totalDiamonds: (tx.totalDiamonds ?? 0n).toString(),
    cultivationReceived: (tx.cultivationReceived ?? 0n).toString(),
    chanceBonusBp: tx.chanceBonusBp ?? 0,
    transactionType: tx.transactionType,
    status: tx.status,
    before,
    after,
    errorMessage: tx.errorMessage ?? null,
    occurredAt:
      tx.occurredAt instanceof Date ? tx.occurredAt.toISOString() : tx.occurredAt,
    createdAt:
      tx.createdAt instanceof Date ? tx.createdAt.toISOString() : tx.createdAt,
  };
}

/**
 * Format a CultivationRealm into OpenAPI Realm schema.
 */
export function formatRealm(realm: CultivationRealm & { levels?: CultivationLevel[] }): any {
  return {
    realmOrder: realm.realmOrder,
    code: realm.code,
    name: realm.name,
    themeColor: realm.themeColor,
    baseChanceBp: realm.baseChanceBp,
    chanceBpPer100Diamonds: realm.chanceBpPer100Diamonds,
    characterMaleAsset: realm.characterMaleAsset,
    characterFemaleAsset: realm.characterFemaleAsset,
    levels: (realm.levels || []).map((l) => ({
      level: l.level,
      requiredExp: l.requiredExp.toString(),
    })),
  };
}

/**
 * Format an AdminAuditLog into OpenAPI AuditLog schema.
 */
export function formatAuditLog(log: any): any {
  if (!log) return null;
  return {
    id: log.id,
    actorApiKeyId: log.actorApiKeyId ?? null,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    before: log.before ?? null,
    after: log.after ?? null,
    reason: log.reason,
    requestId: log.requestId ?? null,
    createdAt:
      log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
  };
}
