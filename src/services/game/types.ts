import { PlayerGender, CultivationRealm, CultivationLevel } from '@prisma/client';

export interface GameConfigValues {
  gameEnabled: boolean;
  giftProcessingEnabled: boolean;
  effectsEnabled: boolean;
  tuViMultiplier: number;
  maxOverflowRatio: number;
  maxChanceBp: number;
  preparationSeconds: number;
  cooldownSeconds: number;
  failurePenaltyRatio: number;
  addExpDuringBreakthrough: boolean;
  maxConcurrentBreakthroughs: number;
  autoJoinOnGift: boolean;
  pendingGiftTtlHours: number;
  defaultGender: PlayerGender;
  commandCooldownSeconds: number;
}

export interface GameConfig {
  revision: number;
  values: GameConfigValues;
  updatedAt: Date;
}

export { CultivationRealm, CultivationLevel, PlayerGender };
